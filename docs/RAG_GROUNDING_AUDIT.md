# RAG answer grounding audit

## Status

**NOT TESTED for generated answers.** Retrieval evaluation runs 50 questions against four synthetic readings with PostgreSQL and deterministic embedding and reranking fixtures. The previous observed Recall@5 is 0.807 vector-only, 0.936 hybrid and 0.936 hybrid plus conditional fixture reranking. Retrieval citation resolution was 59/59, 125/125 and 125/125 respectively. Four of six unsupported questions returned no sources. Two retrieved related but insufficient passages. These figures do not establish whether generated answers abstain or whether their factual claims are supported.

## Human-review workflow

Generate a review file outside the repository:

```powershell
npx tsx scripts/evaluate-grounding.ts template "$env:TEMP/fis-grounding-review.json"
```

For each of 150 strategy-question pairs, record the actual retrieved page keys, generated answer, refusal decision, human relevance judgment, measured latency and provider call counts. Split the answer into factual claims. Assign each claim supported, unsupported, contradicted or unverifiable. Provide the source key, page number and exact supporting or contradicting passage. Explain every non-supported verdict with an error category. The file includes the authored question, expected answer and original evidence passages. Human reviewers must independently judge meaning, including cross-language claims and partial answers.

Score a fully completed file:

```powershell
npx tsx scripts/evaluate-grounding.ts score "$env:TEMP/fis-grounding-review.json"
```

The scorer requires every original question for every strategy, rejects missing judgments and checks that each asserted evidence excerpt exactly occurs on the selected original page and was included among retrieved sources. It counts verdicts, citation integrity, answer relevance, unsupported abstentions, latency and calls. It does not independently judge semantic entailment. The review file and reviewer identities should be retained alongside a run's metrics for reproducibility, with sensitive content excluded from logs.

The template generates no provider calls. The incomplete template was run through the scorer and rejected at the first unanswered record. This validates fail-closed handling and does not establish answer quality. Generated answers, claim annotations, adversarial expansion beyond the six unsupported cases, comparative live inference, and post-fix groundedness measurements are still required. Hosted reranker and generation latency also remain unmeasured. The reranking decision remains provisional until these data exist; no quality-based improvement is claimed.
