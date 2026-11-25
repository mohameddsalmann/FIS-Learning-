# Database and migrations

## Records and ownership

- Better Auth uses User, Account, Session, Verification and RateLimit. The anonymous User carries the guest's ownership. Guest-to-account conversion transfers the supported workspace records and retires the guest identity.
- Course is owned by User and has Topic, Document, Conversation and Quiz children. A Document has a processing job and page-preserving DocumentChunks. Conversation messages can retain scoped citations. Course access resolves ownership through the requested record.
- Quiz owns Question and QuizAttempt data. StudentAnswer and AssessmentResult describe a particular submission. TopicProgress and RevisionItem summarize measured quiz attempts and completed review actions.
- UsageRecord holds scoped quota buckets. ModelHealthRecord tracks observed class of failure and timing for the corresponding capability.

## Schema lifecycle

The first migration, `20261119010000_initial_learning`, builds the schema, constraints and indexes and enables pgvector. GIN indexes the generated `tsvector` and HNSW accelerates cosine distance in supported embedding dimensions. Embedding metadata includes model, dimensions, chunk strategy and processing version. Queries constrain compatible embedding spaces. Course/owner filters and unique keys support isolation, resumability and quiz idempotency.

The additive `20261123000000_document_processing_stages` migration introduces explicit chunking, indexing, and suggestion preparation states. `Document.learningOutline` holds the reusable outline and normalized-content fingerprint. The processing job records the PDF metadata title when present. Previously indexed documents keep their original chunks and readable citations. The course view derives legacy suggestions from the first available passage when a saved outline is absent.

`npm run db:generate` generates the Prisma client. `npm run db:deploy` applies pending migrations with a migration-capable connection. Set `DIRECT_URL` when migrations should bypass the pool. `npm run db:status` reads migration state. Do not run reset operations against any shared or production database. Build generation does not require database connectivity. The integration suite enables mutation tests only on an explicitly isolated loopback connection.

Uploads and deletions cross a storage boundary. The server records reservation/deletion state so cleanup and processing can be resumed. PostgreSQL stores scoped metadata and text, while the PDF binary lives in private Blob.
