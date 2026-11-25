// Preloaded only by check-concurrency.mjs in an isolated Next.js process.
import { Agent, setGlobalDispatcher } from "undici";

const fixtureOrigin = new URL(process.env.FIS_TEST_BOUNDARY_ORIGIN);
if (fixtureOrigin.protocol !== "http:" || fixtureOrigin.hostname !== "127.0.0.1") {
  throw new Error("The product fixture must be on loopback.");
}

const fixtures = new Map([
  ["https://openrouter.ai", "/openrouter"],
  ["https://vercel.com", "/vercel"],
  ["https://fisfixture.private.blob.vercel-storage.com", "/private-blob"],
  ["https://generativelanguage.googleapis.com", "/gemini"],
]);

class IsolatedDispatcher extends Agent {
  dispatch(options, handler) {
    const origin = new URL(options.origin);
    const prefix = fixtures.get(origin.origin);
    if (prefix) {
      return super.dispatch({ ...options, origin: fixtureOrigin.origin, path: prefix + options.path }, handler);
    }
    if (origin.hostname === "127.0.0.1") return super.dispatch(options, handler);
    handler.onError(new Error("External HTTP request blocked in the controlled product check."));
    return false;
  }
}

setGlobalDispatcher(new IsolatedDispatcher());
