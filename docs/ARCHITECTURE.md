# Architecture

```text
Student browser
  ├─ Next.js App Router pages and React study components
  └─ Same-origin Route Handlers in one Next.js deployment
       ├─ Better Auth and workspace services → Prisma/pg → PostgreSQL + pgvector
       ├─ Document processing → private Vercel Blob + PDF.js → checkpointed chunks
       └─ AI services → capability registry + quotas → Gemini, Groq and OpenRouter
                                                    └─ xAI by explicit authorized selection
```

App Router pages own navigation, locale and page composition. React client components manage tutor streaming, settings, source navigation and forms. Tailwind CSS, Lucide and local shadcn-style Radix components share visual tokens and interaction patterns. Zod validates external input. The prepared course is application data with browser-local progress and needs neither a database nor a provider key.

PostgreSQL is the system of record for sessions, user workspaces, learning evidence, quotas and health. Prisma handles ordinary queries and migrations. Generated full-text columns, vector distance, and atomic quota operations use parameterized SQL. Private Blob holds original PDFs, which are streamed through owner-checked routes. Browser memory holds optional personal AI credentials for the active session.

Vercel hosts one application and runs bounded Node Route Handlers. Neon supplies managed PostgreSQL with a pooled runtime connection. Long PDF work advances through durable job checkpoints in response to foreground continuation requests. This keeps the service operable without a separately hosted worker. GitHub Actions verifies code, schema and browser flows before release.

For the migration baseline and current gates, see [implementation status](IMPLEMENTATION_STATUS.md). For system interactions, see the [API](API.md), [database](DATABASE.md) and [RAG pipeline](RAG_PIPELINE.md).
