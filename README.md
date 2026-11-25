# FIS Learning 2.0

FIS helps students turn their PDFs into cited explanations, practice and saved progress. The grayscale workspace supports English and Arabic, tutor history, text, dictation, speech playback, diagrams and supported video clips. An optional pre-authored optics lesson is available independently of provider access.

## Try it locally

Use Node 22.13+ in the 22.x line or Node 24.x.

```sh
npm ci
npm run dev -- --port 3100
```

Open [FIS on localhost](http://localhost:3100). For a private workspace, use `.env.example` to configure a pgvector-enabled PostgreSQL connection, a Better Auth secret and the exact application origin. Run `npm run db:deploy` before starting the app. Connect a **private** Vercel Blob store for PDFs. Verify the Google project and Groq organization tiers before enabling their server credentials. OpenRouter can also route verified free models. [Provider configuration](docs/AI_MODELS.md)

## Study workflow

1. Choose **Study a document** and select a text-based PDF. FIS opens a guest workspace and uploads the file into a new or existing course.
2. Watch processing advance in the course workspace. Choose a suggestion from the PDF, ask the tutor, and open a citation to see the original page beside the answer or in the mobile drawer.
3. Start a Quick Quiz, save feedback, and use the Progress page to review or practice weaker topics. Open **Help** at any time to tour the study workflow.
4. Resume previous tutor conversations under **History**. Create an account to retain the guest workspace and manage data under Settings.

The tutor supports up to five attachments per request, subject to per-request limits. Images and video require a compatible verified-free route. Browser dictation is editable when available. Model selection, response preferences and a session-only key are in Advanced Settings. Free inference exhaustion is reported in the UI. Prepared content is labeled and uses its own local search and quiz bank.

## Implementation

One Next.js App Router application contains React and TypeScript pages, Tailwind styles, reusable Radix controls and Node route handlers. Vercel can deploy the web application with sessions and private data in Neon PostgreSQL through Prisma. pgvector and PostgreSQL full-text search support hybrid retrieval. The server stores original PDFs in private Vercel Blob and uses durable job checkpoints. The provider gateway matches capabilities and free-tier eligibility before dispatching bounded requests.

The previous Express application and the FIS handbook provide the migration baseline. The Next.js commands are the entry points. The [implementation status](docs/IMPLEMENTATION_STATUS.md) records which paths used real local or upstream services, and which used fixtures.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run eval
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `FIS_INTEGRATION_DATABASE=isolated` for database integration tests on an explicitly isolated loopback database. Set `FIS_TEST_DB=1` to enable authenticated browser tests with the migrated test database and local auth secret. GitHub Actions provisions disposable PostgreSQL with pgvector. [Verification and release evidence](docs/IMPLEMENTATION_STATUS.md)

## Documentation

- [Product requirements](docs/PRD.md) and [acceptance requirements](docs/FR_NFR.md)
- [Architecture](docs/ARCHITECTURE.md), [database](docs/DATABASE.md) and [API](docs/API.md)
- [Model routing](docs/AI_MODELS.md), [RAG pipeline](docs/RAG_PIPELINE.md) and [evaluation](docs/AI_EVALUATION.md)
- [Security](docs/SECURITY.md), [deployment](docs/DEPLOYMENT.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Portfolio case study](docs/PORTFOLIO_CASE_STUDY.md) and [repository guide](AGENTS.md)
- [Document-first design research](docs/design/design-research.md)
