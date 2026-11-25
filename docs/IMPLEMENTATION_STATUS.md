# Implementation and release evidence

The migration branch is `codex/fis-learning-2`. FIS remains one Next.js application. Existing Express source, local configuration and legacy browser history were preserved. The legacy browser history stays on its original origin.

## Workflow and design

Home leads with **Study a document**. A guest selects a PDF and uploads it into a new or existing course. The course opens at the new material, shows processing state and gives a contextual link to the tutor after indexing. Practice starts with the learner's course. The prepared optics lesson remains an optional pre-authored example. History reopens a saved conversation with its original course context. See [design research and comparison](design/design-research.md).

The working interface uses monochrome light and dark tones with the original FIS mark. The browser audit checked eight English pages at 360, 390, 768, 1024 and 1440 pixels and five Arabic dark-mode mobile states. No overflow or uncaught page errors were observed. Axe reported zero automated A/AA violations in 21 audited states. Keyboard checks exercised the skip link and mobile navigation. Screen-reader conformance and hosted Web Vitals require separate measurements.

## Verification scope

- The Prisma migration ran against disposable PostgreSQL 16 with pgvector. The production build, TypeScript and ESLint passed. Vitest covered 58 tests across ten files, including provider policy, authorization, retrieval, quota and idempotent feedback. Playwright exercised eight end-to-end tests.
- In the local production build with real private Vercel Blob, a synthetic PDF uploaded, downloaded byte-for-byte by its owner and reached `READY` with a live embedding. An independent guest received 404. The raw object denied unauthenticated access and the owner removed the synthetic object.
- Live generated text from Groq GPT-OSS 20B completed and persisted. Gemini 3.5 Flash-Lite streamed and persisted a course answer with a verified citation to the first page of the stored PDF, with a 1,502 ms time to first token in that smoke test. The same journey linked the guest account, generated a live quiz, saved rubric feedback and persisted topic progress. Quiz feedback also linked to the authorized source passage. Live image and MP4 replies completed with Gemini. Gemini 3.8 and 3.6 encountered timeouts in the initial probes. An OpenRouter free attempt was rate-limited and produced no verified OpenRouter answer. xAI remained disabled. Live speech generation remains unverified.
- The repeatable local load harness uses real app routes, sessions, PostgreSQL and PDF handling. Its upstream provider and Blob HTTP transport are controlled fixtures. It also checks 390px Arabic intake, cited history, persisted quiz results, cross-owner denial, Gemini to eligible OpenRouter fallback, 429 handling and cancellation. Run it from a fresh build against a newly migrated disposable loopback database, with a database name beginning `fis_acceptance_`. Each run consumes the test database's daily quota. See [evaluation](AI_EVALUATION.md) for the command and measured results.

## Hosted gates

The existing hosted project has a private Preview-only Blob store. Vercel's deployment dry run detected Next.js and selected zero local secret or legacy data files. The Preview target still requires the intended Neon connection and a Better Auth secret. Production mode must use separate secrets, storage and database. No hosted preview, migration or promotion was performed. See the [deployment runbook](DEPLOYMENT.md).


## 23 November 2026 learning journey audit

The baseline ran against the pre-overhaul production Next.js build with local PostgreSQL/pgvector and controlled provider and Blob HTTP boundaries. A fresh Arabic mobile 390px guest uploaded a real text PDF, manually advanced indexing, opened the tutor, asked about spring elasticity, followed a page-1 citation, saved 1/1 practice feedback, checked Progress after refresh, and reopened the cited answer from History. Zero uncaught browser errors. Separate load waves succeeded 5/5 and 10/10. These conditions isolate student UX and persistence from a live provider's free quota.

| Priority | Workflow | Baseline findings |
| --- | --- | --- |
| P1 | Upload → indexing | The PDF was already stored when the course opened, but the learner had to press Start Processing and Continue Processing. No continuous progress or byte transfer feedback. Reload resumed from the persisted state but still required manual actions. |
| P1 | Tutor → source | The response linked to the correct page, but it opened a separate full-page viewer. Returning to the answer required another transition. |
| P2 | Opening the course | Materials and tutor lived under separate tabs. Suggested starting questions were generic before the first chat, even with indexed course material. |
| P2 | Tutor answer | The baseline fixture returned one brief cited paragraph. The product supported Markdown but offered no validated visual or teaching blocks within that interaction. |
| P2 | Practice | The learner faced topic, difficulty, format and count fields before generating the quiz. Feedback and persistence worked. |
| P2 | Progress and help | Progress listed weak topics without contextual follow-up links. The home sequence described the three main steps, with no resumable, optional tour. |
| P3 | First visit | The main CTA and mobile layout worked. Returning users could use Home and My Courses, though the tour and checklist were absent. |

Verification for the overhaul appears below. Historical live and release evidence above describes the prior build.

## Overhaul implementation and acceptance

### Study workflow

1. Choose or drop a valid text PDF. The preview shows filename and size, and the transfer reports bytes received by the small-upload HTTP request or by the direct Blob client. Cancel and retry reuse the reservation when possible.
2. The open course advances persisted checkpoints for extraction, chunking, embeddings, index verification, and suggestion preparation. Reopening the course continues pending work. Unexpected failures offer retry, and files without extractable text report an OCR requirement. A verified text index remains usable during an embedding outage. Stage indicators use counters or indeterminate progress according to the available work measurements.
3. On readiness, choose a suggestion drawn from the cached outline or ask a question. The tutor supports automatic style selection and explicit teaching modes. Structured content uses bounded, validated renderers. Exact cited measurements can produce an interactive chart locally, and a validated flowchart uses a restricted Mermaid grammar. Course visual responses can fall back to a link and excerpt from the original PDF.
4. Open the cited page in the desktop source pane or the Arabic and English mobile drawer. The viewer renders the authorized original and highlights a matching excerpt when PDF text geometry is available. Close it to return focus to the citation.
5. Start Quick Quiz with three mixed questions or open its options. Graded feedback records the attempt and links to owned source excerpts. Progress distinguishes attempts, measured accuracy and practiced topics. Weak topics link to review, another quiz and a different explanation.
6. Help restarts the optional three-step native dialog. The five checklist items use saved workspace records and actions made on the current browser. The introductory invitation can be dismissed persistently. The engineering page includes both architecture and retrieval evidence.

### Release checks

- `npm run build`, `npm run lint` and `npm run typecheck` exited 0. `npm run test:e2e` passed 10 of 10 browser tests in 20.3 seconds using a fresh migrated local database.
- `FIS_INTEGRATION_DATABASE=isolated npm test` passed all 84 tests across 12 files with a freshly migrated disposable PostgreSQL+pgvector instance. Coverage includes corrupt PDF and OCR, bounded checkpoints, canceled embedding and retry, text search fallback, unavailable reranking, expired guest sessions, no-source handling, and source deletion during a tutor turn.
- `npm run eval` found the expected top source for six of six answerable prepared optics questions, and returned no source for both unsupported questions. `npm run eval:retrieval` compared three retrieval configurations over 50 questions and four synthetic readings with real PostgreSQL and controlled embedding and reranker inputs. Hybrid Recall@5 was 0.936 compared with vector-only 0.807. Generated-answer groundedness across configurations remains unmeasured. [Full evaluation](AI_EVALUATION.md)
- The production-route browser harness covers an Arabic guest at 390px, all five course layout widths, focus return and highlighting on the original PDF, structured visualization, quiz feedback after reload, cited history, and all five Help checklist items. Axe returned zero automated A/AA findings for the course, open drawer and tour. The browser test recorded zero uncaught page errors. Independent screen-reader and wider browser/device coverage remain open.
- The controlled acceptance harness checks fallback to an eligible free provider, explicit upstream exhaustion and timeout, no-source refusal before generation, stream cancellation and cross-account 404 responses for original files and citation chunks. Coverage uses actual local Next.js and PostgreSQL with controlled provider and storage responses.
- The final controlled concurrency waves completed 5/5 and 10/10 journeys with zero failures, rate limits, or database errors. End-to-end p95 was 427 ms and 685 ms. First-token p95 was 161 ms and 315 ms. These are local fixture timings.

### Live local smoke

The local production build on `http://127.0.0.1:3126` completed a real direct-to-private-Blob upload of a 4.2 MB synthetic PDF. Chrome reported actual transferred bytes. The authorized original matched the input bytes. Four processing requests advanced the file through `EMBEDDING`, `INDEXING`, `PREPARING_SUGGESTIONS`, and `READY`. The resulting one-page file had six cached prompts. Gemini 3.5 Flash-Lite generated a cited answer with both checked claims supported by page 1. Explain visually rendered a source-derived chart whose `2 N` row showed `4 cm` and responded to keyboard selection. A live Quick Quiz saved feedback and the attempt remained present after refreshing Progress. The test account and private file were removed. Zero browser page errors.

During acceptance, the former minute allowance delayed the visual action after ingestion and a tutor answer. Retrieval and generation now have independent minute allowances and share the existing daily limits. Contextual actions reuse available citations, and exact source rows can produce charts without a second generation request. Controlled fixtures separately demonstrate the supported flowchart renderer. Live model-generated illustrations, speech, and cross-configuration answer grounding were outside this run.

### Hosted readiness

A fresh read of the linked Vercel configuration found the private Blob token for Preview. The intended Neon connection and Preview Better Auth secret remain pending. A deployed HTTPS preview, hosted migrations and production promotion require those environment settings and verified hosted acceptance. Local review uses an isolated PostgreSQL instance.

## Prompt acceptance checkpoints, 23 November 2026

**Verdict — below 100%. Local review passes. Production is not ready.** Three of the 12 phases meet their checkpoint, eight are partial, and one is blocked. A phase passes when its requested behavior has code and matching evidence. The count is a checklist, with no weighting for percentage completion.

1. **Pass · Baseline audit.** The baseline Playwright journey covered intake, processing, tutor, citation, quiz, and progress. Findings were prioritized in the audit above.
2. **Partial · Document upload and processing.** Cancel/retry, persisted checkpoints, real transfer bytes, and automatic processing while the course is open are implemented. Live direct upload succeeded. To close, interrupt a direct Blob upload after bytes move, reload, resume or retry the reservation, and compare the stored original byte for byte. Run a long representative PDF on hosted Preview to measure extraction time and memory headroom.
3. **Pass · Course understanding.** Ingestion builds and caches the document outline. Source-based suggestions appear on readiness and can be selected in the tutor. Cached prompts were observed in the live smoke and tested with controlled materials.
4. **Pass · Teaching engine.** Seven requested styles and auto selection use bounded, validated rendering with safe prose fallback. Tests cover grounding validation for structured blocks. Broad answer quality is measured under checkpoint 6.
5. **Partial · Visual learning.** Safe SVG, restricted Mermaid flowcharts, charts, timelines, comparison tables, and equations are implemented. The live course produced an interactive chart from cited values. The document excerpt currently shows a quote and opens the original rendered PDF page. To close, render an image excerpt within the visual response, exercise representative non-physics materials, and verify live illustrations when an eligible free image route is available.
6. **Partial · RAG and evaluation.** The fresh PostgreSQL fixture benchmark ran 50 questions across four readings. Recall@5 was 80.7%, 93.6%, and 93.6% for vector, hybrid, and hybrid with conditional reranking. Resolved citations were 59/59, 125/125, and 125/125. Four of six unsupported questions retrieved zero sources, which measures retrieval. To close, grade generated claims and model refusals across all three configurations against human-reviewed evidence, including the two unsupported queries that retrieved related passages.
7. **Partial · Study workspace.** The desktop pane and mobile drawer show the cited original page, highlight text where possible, and restore focus. Contextual actions attach to the latest reply. To close, enable and verify those actions on earlier replies while binding them to the selected reply's context.
8. **Partial · Guided Help.** The native bilingual tour has dismissal persistence, keyboard navigation, and a Help entry point. Checklist actions use real activity, with two browser-local flags that can carry across accounts. Status is inline. To close, scope completion to the learner, verify an account switch, and add the requested non-blocking toasts.
9. **Partial · Quiz and progress.** Quick Quiz, saved feedback, revision actions, and separate accuracy, attempts and topic coverage are implemented. A mastery estimate is withheld while evidence is insufficient. To close, define and validate a separate estimate with a minimum evidence threshold and show an explicit insufficient-evidence state where appropriate.
10. **Partial · Design polish.** The monochrome brand, custom upload interaction, and engineering case study are in place. Loading states show text. To close, add the requested skeleton states and verify their behavior on slow loads and all supported widths.
11. **Partial · End-to-end acceptance.** The documented local live Gemini journey and controlled Arabic journey cover core success and most failure scenarios. Five fresh browser checks passed in 19.5 seconds for sample-to-quiz, five widths, Arabic RTL, tour reopen, and signed-out access. Direct transfer interruption with reload remains open. The live smoke and full 10-test run are prior evidence.
12. **Blocked · Hosted release.** Local build, typecheck, lint, 84 tests, and 10 browser tests were recorded previously. The current lint and both evaluation commands passed. The linked Vercel project currently reports the Preview Blob credential in the checked settings, with the Neon connection and Better Auth secret absent. The app remains untracked in the working tree. To close, pin the release revision, configure isolated hosted dependencies, run migrations and authenticated HTTPS acceptance, and verify the free-only environment. The code's explicit paid xAI option defaults to disabled and must stay disabled for this release.

## Upload recovery continuation

A refresh during intake now redirects the same browser tab to its existing course after an upload reservation is created. The student can use the course's existing incomplete-upload recovery controls. The shortcut is stored in session storage and contains only the course identifier. The original file must be selected again.

The new Playwright regression simulates a connection reset after reservation, reloads intake, and verifies navigation to the existing course. It passed. The full Playwright suite passed 11/11 with a freshly migrated isolated PostgreSQL database and test-only authentication. Production build, typecheck and lint passed. The default Vitest run passed 66 tests and skipped 18 database integration tests. A real mid-transfer interruption, retry and SHA-256 byte comparison remain unverified. The next unfinished task is completing that real upload recovery test before message-specific actions.

## Live interrupted upload recovery

On 23 November, `scripts/check-upload-recovery.py` ran twice against an isolated local PostgreSQL database and the private Preview Blob store. Chrome at 390px throttled a real 4,209,346-byte PDF upload, observed transferred bytes, and switched offline. After refresh, the reservation showed `UPLOADING`. The server found the already committed private object and finalized the same document. Processing reached `READY`, the course contained one document, and the authorized PDF SHA-256 matched the original `73021596fc3f3bb9ac0dbb34bcb7332bca4750f534910c1850657f3b82656de8`. Each test account and object was removed. This run exercised the committed-object recovery branch. Browser recovery when the object is absent remains unverified; the isolated integration suite previously tested its reservation and retry path. The script accepts only an explicit loopback origin and removes its disposable account.
