# Requirements and acceptance

## Functional requirements

- **FR-01 Learning entry.** Home links to a prepared sample and a guest workspace. The dashboard lists owned courses, actual conversations, quiz attempts, and due revision work.
- **FR-02 Materials.** An authorized learner can create a course, organize topics, upload a text PDF privately, inspect its job state, retry processing and delete it. A second learner receives an unavailable response.
- **FR-03 Tutor.** A streamed reply supports Markdown, math and code. The learner can stop, regenerate, copy, listen, ask for simpler explanations, or create practice. An error preserves the draft. Course citations resolve to owned, ready document chunks.
- **FR-04 Multimodal.** Allow up to five attachments for a tutor request, subject to payload and media limits. Input validation and modality-aware free routing apply. Dictation is editable, with an unsupported-browser message where needed.
- **FR-05 Practice.** The learner sets difficulty and question count, submits multiple choice, true/false and short answers, receives rubric feedback, and can see saved attempts and topic performance.
- **FR-06 Personal data.** Language and theme are selectable. A guest can convert to an account. Workspace export and deletion act on the current owner. The personal provider key remains in memory for the active page session.
- **FR-07 Product evidence.** Engineering links to actual architecture, source and evaluation results. Every report identifies prepared, fixture, isolated database and hosted evidence.

## Nonfunctional requirements

- **NFR-01 Security.** Use signed sessions, owner-scoped queries, input bounds, private PDF streaming, quota checks, stable sanitized errors and server-only provider credentials. Reject unknown, expired and unverified-price models.
- **NFR-02 Reliability.** Bound provider time, context, retries, attachment sizes and processing batches. Continue a checkpointed job after interruption. Keep retry idempotency on the quiz attempt and document workflow.
- **NFR-03 Accessibility.** Provide semantic input and focus states, keyboard-operated comboboxes, proper document direction and reduced-motion support. Use the requested five widths for layout checks. A complete assistive-technology conformance assessment remains a separate release gate.
- **NFR-04 Performance.** Target LCP at or below 2.5 s and INP at or below 200 ms on supported devices. Establish these with a deployed measurement. Use limited client hydration, dynamic PDF loading and bounded source queries.
- **NFR-05 Deployment.** Ship one Next.js application. Apply the reviewed SQL migrations to each isolated database and use private Blob. Run hosted public, private and free-provider smoke tests before declaring readiness.

See [implementation status](IMPLEMENTATION_STATUS.md) for evidence and open gates.
