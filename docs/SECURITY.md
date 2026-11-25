# Security and privacy

## Boundaries

- Session state uses Better Auth. Anonymous sessions have bounded auth creation and AI call budgets. Workspace reads and mutations scope by the signed user and owned course. Missing or cross-owner resources return an unavailable response. Guest-to-account conversion transfers supported rows in a transaction.
- Private PDFs have size, type and byte-signature checks. Larger PDFs use a server-authorized Blob token for the reserved path. Only authenticated owners receive a file stream or citation excerpt. Private files and exports use no-store response headers. Export includes workspace JSON, and private originals remain downloadable through their owner route.
- Provider keys are server-only unless explicitly supplied by the learner. A personal key exists in memory for the active session and is sent in a same-origin AI request header. The selected provider receives the question, applicable attachments and bounded course evidence. The deployed configuration must confirm Google and Groq Free plans independently. Browser dictation may involve the browser vendor's processing.
- Retrieved content is untrusted evidence. Citation resolution applies a server source-ID allowlist and owner checks. SQL uses parameter binding. Chat constraints bound user text and files, validate signatures and limit supported MP4 duration. Generic errors exclude request payloads, keys and private file paths.
- A workspace owner can export and request deletion. Deletion marks state before removing private file objects and their database records. The prepared course keeps its sample attempts locally in the browser.

## Release checks

The test suite covers unauthenticated routes, cross-owner reads, invalid and paid model IDs, oversized/invalid attachments, quota enforcement, private document validation, and answer-key elision. Extend release evidence with configured Vercel Blob private access from an independent session, secure cookie checks on HTTPS, provider data retention review, and assistive-technology testing. This project has no independent security certification.
