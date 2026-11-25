import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { AiError, aiErrorFor, type AiErrorCode, type ProviderErrorCategory } from "./errors";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { nonnegativeInteger, objectFields, observeProviderStream, providerUsage, retryAfterSeconds, secondsUntilMidnight, upstreamError,
  type AiModel, type CredentialStatus, type InferenceProvider, type ProviderId, type ProviderStatus, type ProviderUsage } from "./provider";
import { OpenRouterRegistry, hasKnownModel, inferencePaths, type Capability } from "./registry";
import { XaiProvider } from "./xai";

export interface ProviderAttempt {
  provider: ProviderId;
  modelId: string;
  endpoint: string;
  rateScope?: string;
}
export type AuthorizeAttempt = (capability: Capability, attempt?: ProviderAttempt) => Promise<unknown>;
export type ProviderAttemptReport = ProviderAttempt & ProviderUsage & {
  attemptId?: string;
  status: AiErrorCode | "available";
  latencyMs: number;
  rateLimitCategory?: ProviderErrorCategory;
  retryAt?: Date;
};
export type ProviderCooldown = { status: AiErrorCode; until: Date; retryCategory?: string };
type HealthReporter = (entry: { modelId: string; status: string; latencyMs: number }) => Promise<unknown>;
type Requirements = Partial<Pick<AiModel, "media" | "structured">> & { minContext?: number };

export const freeRouting = { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } };
const openRouterOrigin = "https://openrouter.ai";
const costFilterPaths = new Set<Capability>(["chat", "decision", "embedding", "rerank"]);
const providerFailures = new Set<AiErrorCode>(["invalid_credentials", "rate_limited", "billing_unavailable"]);
const retryable = new Set<AiErrorCode>(["no_free_route", "unavailable", "timeout", "invalid_response", "unsupported_media", "provider_budget"]);
const providersInCatalog: ProviderId[] = ["gemini", "groq", "openrouter", "xai"];
const cooldownMs = 30_000;
const maxAttempts = 4;

const openRouterPool = (name: string) => `openrouter:pool:${name.trim().toLowerCase()}`;
const modelScope = (provider: ProviderId, modelId: string) => `${provider}:model:${modelId}`;

function openRouterError(status: number, value: unknown, headers: Headers, fallbackPool: string) {
  const frame = objectFields(value);
  const error = objectFields(frame.error);
  const metadata = objectFields(error.metadata);
  const nestedHeaders = objectFields(metadata.headers);
  const readHeader = (name: string) => headers.get(name) ?? Object.entries(nestedHeaders).find(([key]) => key.toLowerCase() === name)?.[1];
  const source = metadata.limit_source;
  const type = metadata.error_type;
  const code = nonnegativeInteger(error.code) ?? status;
  if (source === "openrouter_key_limit" || source === "openrouter_credits" ||
    source === "openrouter_guardrail_budget" || source === "openrouter_workspace_budget") {
    const reset = typeof metadata.resets_at === "string" ? retryAfterSeconds(metadata.resets_at) : undefined;
    return new AiError("billing_unavailable", reset, "openrouter", "billing");
  }
  if (code === 429 || type === "rate_limit_exceeded" || source === "openrouter_in_flight_budget") {
    const now = Date.now();
    const reset = nonnegativeInteger(readHeader("x-ratelimit-reset"));
    const resetMs = reset !== undefined && reset < 100_000_000_000 ? reset * 1000 : reset;
    const daily = source === "openrouter_free_tier_daily";
    const namedPool = typeof metadata.provider_name === "string" ? metadata.provider_name
      : typeof frame.provider === "string" ? frame.provider : undefined;
    const pool = source === "upstream_provider_shared_pool" || (source == null && Boolean(namedPool?.trim()));
    const wait = Math.max(retryAfterSeconds(String(readHeader("retry-after") ?? ""), now) ?? 0,
      resetMs === undefined ? 0 : Math.ceil((resetMs - now) / 1000),
      daily && resetMs === undefined ? secondsUntilMidnight("UTC", now) : 0);
    const category = pool ? "openrouter_upstream_pool" : daily ? "openrouter_daily"
      : source === "openrouter_free_tier_per_minute" ? "openrouter_minute" : "openrouter_rate";
    return new AiError("rate_limited", wait || undefined, pool ? openRouterPool(namedPool?.trim() || fallbackPool) : "openrouter",
      category, nonnegativeInteger(readHeader("x-ratelimit-remaining")));
  }
  if (type === "context_length_exceeded" || type === "unsupported_modality" || type === "unsupported_parameter") {
    return new AiError("unsupported_media", undefined, undefined, "unsupported");
  }
  if (type === "provider_timeout") return new AiError("timeout", undefined, undefined, "timeout");
  return upstreamError(code >= 400 ? code : 503);
}

function providerEndpoint(provider: ProviderId, model: AiModel, stream: boolean) {
  if (provider === "gemini") {
    const method = model.kind === "embedding" ? "batchEmbedContents" : stream ? "streamGenerateContent" : "generateContent";
    return `/v1beta/models/${model.id.slice("google/".length)}:${method}`;
  }
  return provider === "groq" ? "/openai/v1/chat/completions" : provider === "xai" ? "/v1/responses" : inferencePaths[model.kind];
}

export class OpenRouterProvider implements InferenceProvider {
  readonly id = "openrouter";
  private readonly registry: OpenRouterRegistry;

  constructor(private readonly request: typeof fetch = fetch) {
    this.registry = new OpenRouterRegistry(request);
  }

  configured() { return Boolean(sharedOpenRouterKey()); }
  enabled() { return this.configured(); }
  hasModel(kind: Capability, id: string) { return hasKnownModel(kind, id); }
  models(kind: Capability) { return this.registry.models(kind); }
  verify(model: AiModel) { return model.cost === "free" ? this.registry.provider({ ...model, cost: "free" }) : Promise.resolve(null); }

  async send(model: AiModel, payload: Record<string, unknown>, apiKey: string | undefined, signal: AbortSignal) {
    if (!apiKey) throw new AiError("not_configured");
    if (model.cost !== "free" || !this.hasModel(model.kind, model.id)) throw new AiError("no_free_route");
    const guardedPayload = {
      ...payload, model: model.id,
      ...(costFilterPaths.has(model.kind) ? { provider: freeRouting } : {}),
    };
    const response = await this.request(openRouterOrigin + inferencePaths[model.kind], {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json", "X-Title": "FIS Learning" },
      cache: "no-store", redirect: "error", signal,
      body: JSON.stringify(guardedPayload),
    });
    if (!response.ok) {
      throw openRouterError(response.status, await response.json().catch(() => null), response.headers, model.provider);
    }
    return response;
  }
}

export interface InferenceOptions {
  authorizeAttempt: AuthorizeAttempt;
  apiKey?: string;
  openRouterOnly?: boolean;
  signal?: AbortSignal;
  model?: string;
  requirements?: Requirements;
  allowFallback?: boolean;
  reportHealth?: HealthReporter;
  reportAttempt?: (entry: ProviderAttemptReport) => Promise<unknown>;
  readCooldown?: (scope: string) => Promise<ProviderCooldown | null>;
  writeCooldown?: (entry: ProviderCooldown & { scope: string }) => Promise<unknown>;
}

export function sharedOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

export function optionalOpenRouterKey(request?: Request) {
  const personal = request?.headers.get("x-fis-openrouter-key");
  if (personal != null) {
    if (!/^sk-or-v1-[a-f0-9]{64}$/i.test(personal)) throw new AiError("invalid_credentials");
    return personal;
  }
  return sharedOpenRouterKey();
}

export function getOpenRouterKey(request?: Request) {
  const key = optionalOpenRouterKey(request);
  if (!key) throw new AiError("not_configured");
  return key;
}

function requirementsMatch(model: AiModel, requirements: Requirements) {
  return (!requirements.structured || model.structured)
    && (requirements.media ?? []).every((type) => model.media.includes(type))
    && (!requirements.minContext || (model.contextLength ?? 0) >= requirements.minContext);
}

function isCurrent(model: AiModel) {
  return !model.expires || model.expires > new Date().toISOString().slice(0, 10);
}

function leasedResponse(response: Response, signal: AbortSignal, release: () => void, finish?: (error: AiError) => Promise<void>) {
  if (!response.body) { release(); return response; }
  const reader = response.body.getReader();
  let closed = false;
  function close() {
    signal.removeEventListener("abort", abort);
    release();
  }
  function cancel(error = new AiError("cancelled")) {
    if (closed) return;
    closed = true;
    close();
    return Promise.all([finish?.(error), reader.cancel().catch(() => undefined).finally(() => reader.releaseLock())]);
  }
  function abort() { void cancel(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
    ? new AiError("timeout", undefined, undefined, "timeout") : new AiError("cancelled")); }
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) { closed = true; reader.releaseLock(); close(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) { await cancel(aiErrorFor(error)); controller.error(error); }
    },
    async cancel() { await cancel(); },
  }), { headers: response.headers, status: response.status });
}

type Candidate = { model: AiModel; adapter: InferenceProvider };
type ProviderView = { status: ProviderStatus; credential: CredentialStatus; category?: ProviderErrorCategory; retryAfter?: number };

export class FreeAiGateway {
  private readonly providers: InferenceProvider[];
  private readonly failedProviders = new Map<string, ProviderCooldown>();
  private readonly credentialVerified = new Set<ProviderId>();
  private inFlight = 0;

  constructor(openRouter: InferenceProvider = new OpenRouterProvider(), otherProviders: InferenceProvider[] = [], private readonly concurrency = 10) {
    const adapters = [openRouter, ...otherProviders];
    this.providers = providersInCatalog.flatMap((id) => adapters.find((adapter) => adapter.id === id) ?? []);
  }

  private localCooldown(scope: string) {
    const failure = this.failedProviders.get(scope);
    return failure && failure.until.getTime() > Date.now() ? failure : undefined;
  }

  private async providerFailure(scope: string, read?: InferenceOptions["readCooldown"]) {
    const local = this.localCooldown(scope);
    const shared = await read?.(scope).catch(() => null);
    const failure = shared && (!local || shared.until > local.until) ? shared : local;
    return failure && failure.until.getTime() > Date.now()
      ? new AiError(failure.status, Math.ceil((failure.until.getTime() - Date.now()) / 1000), scope,
        failure.retryCategory as ProviderErrorCategory | undefined) : undefined;
  }

  private scopes(adapter: ProviderId, model: AiModel) {
    return [modelScope(adapter, model.id), ...(adapter === "openrouter" ? [openRouterPool(model.provider)] : [])];
  }

  private availability({ model, adapter }: Candidate) {
    return [adapter.id, ...this.scopes(adapter.id, model)].some((scope) => this.localCooldown(scope))
      ? "degraded" as const : "available" as const;
  }

  async catalog(readCooldown?: InferenceOptions["readCooldown"]) {
    const empty: ProviderView = { status: "not_configured", credential: "missing" };
    const providers = Object.fromEntries(providersInCatalog.map((id) => [id, empty])) as Record<ProviderId, ProviderView>;
    const kinds = Object.keys(inferencePaths) as Capability[];
    const cooldowns = new Map<string, Promise<AiError | undefined>>();
    const cooldownFor = (scope: string) => {
      const previous = cooldowns.get(scope);
      if (previous) return previous;
      const pending = this.providerFailure(scope, readCooldown);
      cooldowns.set(scope, pending);
      return pending;
    };
    const byProvider = await Promise.all(this.providers.map(async (adapter) => {
      const [modelsByKind, reportedCredential, failure] = await Promise.all([
        Promise.allSettled(kinds.map((kind) => adapter.models(kind))),
        adapter.credentialStatus?.().catch(() => "unverified" as const) ?? Promise.resolve(
          !adapter.configured() ? "missing" as const : this.credentialVerified.has(adapter.id) ? "verified" as const : "unverified" as const,
        ),
        cooldownFor(adapter.id),
      ]);
      const eligible = modelsByKind.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []).filter(isCurrent);
      const verified = await Promise.all(eligible.map(async (model) => {
        const provider = await adapter.verify(model).catch(() => null);
        if (!provider) return null;
        const modelFailure = failure ?? (await Promise.all(this.scopes(adapter.id, { ...model, provider }).map(cooldownFor))).find(Boolean);
        return { ...model, provider, gateway: adapter.id, availability: modelFailure ? "degraded" as const : "available" as const,
          category: modelFailure?.category, retryAfter: modelFailure?.retryAfter };
      }));
      const models = verified.filter((model) => model !== null);
      const status: ProviderStatus = !adapter.configured() ? "not_configured" : !adapter.enabled() ? "disabled"
        : failure ? "degraded" : !models.length ? "unavailable"
          : modelsByKind.some((entry) => entry.status === "rejected") || models.every((model) => model.availability === "degraded") ? "degraded" : "available";
      providers[adapter.id] = { status, credential: failure?.code === "invalid_credentials" ? "rejected" : reportedCredential,
        category: failure?.category, retryAfter: failure?.retryAfter };
      return models;
    }));
    const normal = [providers.gemini.status, providers.groq.status, providers.openrouter.status];
    const status: ProviderStatus = normal.includes("available") ? "available" : normal.includes("degraded") ? "degraded"
      : normal.includes("unavailable") ? "unavailable" : "not_configured";
    return { models: byProvider.flat(), providers, status };
  }

  private claim() {
    if (this.inFlight >= this.concurrency) throw new AiError("provider_busy");
    this.inFlight++;
    let released = false;
    return () => {
      if (!released) { released = true; this.inFlight--; }
    };
  }

  async run<Result>(
    kind: Capability,
    payload: (model: AiModel) => Record<string, unknown>,
    decode: (response: Response, model: AiModel) => Promise<Result>,
    options: InferenceOptions,
  ) {
    const apiKey = options.apiKey ?? sharedOpenRouterKey();
    const personal = options.openRouterOnly || Boolean(apiKey && apiKey !== sharedOpenRouterKey());
    const explicitModel = options.model && options.model !== "auto" ? options.model : undefined;
    const preferredAdapter = explicitModel ? this.providers.find((adapter) => adapter.hasModel(kind, explicitModel)) : undefined;
    if (explicitModel && (!preferredAdapter || (personal && preferredAdapter.id !== "openrouter"))) throw new AiError("invalid_model");
    const pinned = preferredAdapter?.id === "xai" || Boolean(explicitModel && options.allowFallback === false);
    const deadline = AbortSignal.timeout(45_000);
    const requestSignal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const checkCancellation = () => {
      if (requestSignal.aborted) {
        throw new AiError(requestSignal.reason instanceof DOMException && requestSignal.reason.name === "TimeoutError" ? "timeout" : "cancelled");
      }
    };
    checkCancellation();
    const adapters = this.providers.filter((adapter) => {
      if (pinned && adapter !== preferredAdapter) return false;
      if (personal && adapter.id !== "openrouter") return false;
      if (adapter.id === "xai" && preferredAdapter !== adapter) return false;
      return adapter.id === "openrouter" ? Boolean(apiKey) : adapter.enabled();
    });
    if (!adapters.length) throw new AiError(pinned && preferredAdapter?.configured() ? "billing_unavailable" : "not_configured");
    const rejectedProviders = new Set<string>();
    const attemptedProviders = new Set<ProviderId>();
    const cooldowns = new Map<string, Promise<AiError | undefined>>();
    const getFailure = (scope: string) => {
      if (personal) return Promise.resolve(undefined);
      const cached = cooldowns.get(scope);
      if (cached) return cached;
      const pending = this.providerFailure(scope, options.readCooldown);
      cooldowns.set(scope, pending);
      return pending;
    };
    const discovered = await Promise.allSettled(adapters.map(async (adapter) => {
      const failure = await getFailure(adapter.id);
      if (failure) throw failure;
      return (await adapter.models(kind)).filter(isCurrent).map((model): Candidate => ({ adapter, model }));
    }));
    checkCancellation();
    const candidates = discovered.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
    const compatible = candidates.filter(({ model, adapter }) => requirementsMatch(model, options.requirements ?? {})
      && (model.cost === "free" || (adapter.id === "xai" && model.id === explicitModel)));
    const preferred = compatible.find(({ model }) => model.id === explicitModel);
    if (explicitModel && !preferred && candidates.some(({ model }) => model.id === explicitModel)) throw new AiError("invalid_model");
    const alternatives = compatible.filter(({ model }) => model.id !== explicitModel);
    const remaining = [...(preferred ? [preferred] : []), ...(pinned ? [] : alternatives.sort((left, right) =>
      Number(this.availability(left) === "degraded") - Number(this.availability(right) === "degraded")))];
    let lastError = new AiError(pinned && preferredAdapter?.id === "xai" ? "billing_unavailable" : "no_free_route");
    for (const outcome of discovered) {
      if (outcome.status === "rejected") { lastError = aiErrorFor(outcome.reason); break; }
    }
    let attempts = 0;

    while (remaining.length && attempts < maxAttempts) {
      const { adapter, model: candidate } = remaining.shift()!;
      if (rejectedProviders.has(adapter.id)) continue;
      checkCancellation();
      let provider: string | null;
      try { provider = await adapter.verify(candidate); }
      catch (error) { lastError = aiErrorFor(error); continue; }
      if (!provider) continue;
      const model = { ...candidate, provider };
      const scopes = this.scopes(adapter.id, model);
      if (scopes.some((scope) => rejectedProviders.has(scope))) continue;
      const blocked = (await Promise.all(scopes.map(getFailure))).find(Boolean);
      if (blocked) { lastError = blocked; continue; }
      checkCancellation();
      const body = payload(model);
      const attemptRoute: ProviderAttempt = { provider: adapter.id, modelId: model.id,
        endpoint: providerEndpoint(adapter.id, model, body.stream === true), rateScope: scopes.at(-1) };
      const attemptController = new AbortController();
      const attemptTimeout = AbortSignal.timeout(options.requirements?.media?.includes("video") ? 28_000 : 22_000);
      const signal = AbortSignal.any([requestSignal, attemptController.signal, attemptTimeout]);
      let authorizationError: unknown;
      let upstreamAttempt: { id?: string; start: number } | undefined;
      let usage: ProviderUsage = {};
      let handedOff = false;
      const finish = async (error?: AiError, cooldown = true) => {
        const current = upstreamAttempt;
        if (!current) return;
        upstreamAttempt = undefined;
        const defaultScope = error && providerFailures.has(error.code) ? adapter.id : scopes[0];
        const scope = error?.scope ?? defaultScope;
        const canCool = error && error.code !== "provider_budget" && (providerFailures.has(error.code)
          || error.code === "timeout" || error.code === "unavailable" || error.code === "invalid_response");
        const wait = error?.retryAfter ?? (canCool && cooldown ? cooldownMs / 1000 : undefined);
        const retryAt = wait === undefined ? undefined : new Date(Date.now() + wait * 1000);
        if (error && canCool && cooldown && retryAt) {
          rejectedProviders.add(scope);
          if (!personal) {
            const entry = { status: error.code, until: retryAt, retryCategory: error.category };
            const existing = this.localCooldown(scope);
            if (!existing || entry.until > existing.until) this.failedProviders.set(scope, entry);
            await options.writeCooldown?.({ scope, ...entry }).catch(() => undefined);
          }
        }
        if (!error && !personal) this.credentialVerified.add(adapter.id);
        const status = error?.code ?? "available";
        const latencyMs = Date.now() - current.start;
        await Promise.all([
          options.reportAttempt?.({ ...attemptRoute, ...usage, attemptId: current.id, status, latencyMs,
            ...(error ? { rateScope: scope, rateLimitCategory: error.category, retryAt,
              remainingRequests: error.remainingRequests ?? usage.remainingRequests } : {}) }).catch(() => undefined),
          (!personal || !error || retryable.has(error.code))
            ? options.reportHealth?.({ modelId: model.id, status, latencyMs }).catch(() => undefined) : undefined,
        ]);
      };
      const reserve = async (retryOf?: AiError) => {
        if (retryOf) await finish(retryOf, false);
        if (attempts >= maxAttempts) throw new AiError("no_free_route");
        signal.throwIfAborted();
        try {
          const id = await options.authorizeAttempt(kind, attemptRoute);
          upstreamAttempt = { id: typeof id === "string" ? id : undefined, start: Date.now() };
        }
        catch (error) { authorizationError = error; throw error; }
        signal.throwIfAborted();
        attempts++;
        attemptedProviders.add(adapter.id);
      };
      const release = this.claim();
      try {
        await reserve();
        const response = await adapter.send(model, body, apiKey, signal, reserve);
        usage.remainingRequests = nonnegativeInteger(response.headers.get("X-RateLimit-Remaining-Requests") ?? response.headers.get("X-RateLimit-Remaining"));
        const stream = response.headers.get("Content-Type")?.startsWith("text/event-stream");
        const delivered = leasedResponse(response, signal, release, (error) => stream && handedOff ? finish(error) : Promise.resolve());
        if (stream) {
          let emittedText = false;
          observeProviderStream(delivered, async (event) => {
            if (event === undefined || event === "[DONE]") {
              await finish(event === "[DONE]" && emittedText ? undefined : new AiError("invalid_response"));
              return;
            }
            let frame: Record<string, unknown>;
            try { frame = objectFields(JSON.parse(event)); } catch { return; }
            const choice = Array.isArray(frame.choices) ? objectFields(frame.choices[0]) : {};
            const content = objectFields(choice.delta).content;
            emittedText ||= typeof content === "string" && Boolean(content.trim());
            const reported = providerUsage(frame);
            usage.inputTokens = reported.inputTokens ?? usage.inputTokens;
            usage.outputTokens = reported.outputTokens ?? usage.outputTokens;
            if (frame.error || choice.finish_reason === "error" || choice.finish_reason === "content_filter") {
              const error = choice.finish_reason === "content_filter" ? new AiError("content_blocked")
                : adapter.id === "openrouter" ? openRouterError(200, frame, response.headers, model.provider)
                  : upstreamError(nonnegativeInteger(objectFields(frame.error).code) ?? 503);
              await finish(error);
              throw error;
            }
          });
        } else if (kind !== "image" && kind !== "speech" && response.headers.get("Content-Type")?.includes("application/json") &&
          (options.reportAttempt || adapter.id === "openrouter")) {
          const frame = objectFields(await delivered.clone().json().catch(() => null));
          usage = { ...usage, ...providerUsage(frame) };
          if (adapter.id === "openrouter" && frame.error) throw openRouterError(200, frame, response.headers, model.provider);
        }
        const result = await decode(delivered, model);
        handedOff = true;
        if (!stream) await finish();
        return { result, model };
      } catch (error) {
        const cause = attemptTimeout.aborted ? new AiError("timeout", undefined, undefined, "timeout") : aiErrorFor(error);
        await finish(cause);
        attemptController.abort();
        release();
        if (authorizationError && cause.code !== "provider_budget") throw authorizationError;
        checkCancellation();
        if (cause.code === "provider_budget") rejectedProviders.add(cause.scope ?? adapter.id);
        if (!retryable.has(cause.code) && !providerFailures.has(cause.code)) throw cause;
        lastError = cause;
        const alternative = remaining.findIndex(({ adapter: next }) => !attemptedProviders.has(next.id) && !rejectedProviders.has(next.id));
        if (alternative > 0) remaining.unshift(remaining.splice(alternative, 1)[0]);
        if (attempts < maxAttempts && remaining.some(({ adapter: next }) => !rejectedProviders.has(next.id))) {
          await delay(150, undefined, { signal: requestSignal }).catch(() => undefined);
        }
      }
    }
    checkCancellation();
    throw lastError;
  }
}

export const gateway = new FreeAiGateway(new OpenRouterProvider(), [new GeminiProvider(), new GroqProvider(), new XaiProvider()]);
