# FIS Learning repository guide

Study journeys live in `src/app` and `src/components`. Keep page-local interaction in client components and database, storage, and OpenRouter calls in `src/server`. Keep `src/server/db/generated` generated and ignored. The application entry point is `npm run dev` or `npm start` after a build.

For a student-facing change, verify English and Arabic direction, keyboard operation, empty and failure states, and widths from 360px to 1440px. Use the global frontend research, implementation, and audit workflow in the appropriate scope. Preserve the geometry of the supplied FIS mark and use the monochrome light and dark tokens. Use the shared anchored searchable combobox for interactive choices.

Keep the prepared optics course usable with no account or provider. Clearly label prepared content and fixture results. Keep AI billing eligibility fail-closed. Apply session and ownership checks to every private action, serve original PDFs from authenticated routes, and parameterize SQL. Never print credentials or student content. Use an isolated local PostgreSQL database for integration tests. Apply production migrations with `npm run db:deploy`.

Before claiming a change is verified, run its specific regression check and record the result. The shared release checks are `npm run typecheck`, `npm run lint`, `npm test`, `npm run eval`, `npm run build`, and `npm run test:e2e`. Mark fixture-only and hosted-only behavior explicitly. Keep the affected files in `docs` current.

The original Express entry point and static source are historical migration references. Protect local `.env`, legacy browser storage, and `data/` from incidental changes.
