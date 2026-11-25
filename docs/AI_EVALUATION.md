# AI evaluation

## Prepared course

Run `npm run eval`. The checked-in set has six positive questions in English and Arabic and two out-of-scope questions. Expected relevance is declared before evaluation. The latest run found six of six expected sources at rank one, yielding Recall@2 of 1.00 and MRR of 1.00. Six top citations matched their expected lesson IDs and both out-of-scope cases abstained. This is a small deterministic lexical baseline. It measures lesson retrieval, with no provider traffic.

## Private-course retrieval and generation

### Controlled retrieval benchmark on 23 November 2026

The benchmark runs the actual PostgreSQL full-text, pgvector, fusion and citation resolution code with deterministic bilingual embedding and reranking fixtures. It used 50 authored questions over four synthetic readings and 16 pages. The dataset includes 44 answerable questions and six unsupported questions. Each question includes graded relevant page keys and a short expected answer for human review. Grade 2 means direct evidence and grade 1 means supplementary evidence. [Readings and question dataset](../scripts/retrieval-evaluation-data.ts).

Apply migrations to a disposable loopback PostgreSQL database named `fis_retrieval_eval` or `fis_test`. Set `DATABASE_URL` to its local connection and `FIS_INTEGRATION_DATABASE=isolated` before running.

```text
npm run db:deploy
npm run eval:retrieval
npm run eval:retrieval -- --details
```

The evaluator seeds an isolated learner and course, removes them after the run, and never calls a hosted provider. Vector-only draws candidates from pgvector. Hybrid adds PostgreSQL full-text search and Reciprocal Rank Fusion and is the live tutor baseline. The third variant explicitly opts into the local controlled reranker for comparison. Neighbor expansion is disabled for all three variants to isolate candidate ranking.

| Measure | Vector only | Hybrid | Hybrid + conditional rerank |
| --- | ---: | ---: | ---: |
| Recall@5 | 0.807 | 0.936 | 0.936 |
| Recall@5, 10 dedicated cross-language questions | 0.950 | 0.950 | 0.950 |
| MRR | 0.886 | 0.955 | 0.955 |
| nDCG@5 | 0.835 | 0.925 | 0.927 |
| Exact document, page and excerpt references | 59/59 | 125/125 | 125/125 |
| All direct answer evidence in first five results | 34/44 | 41/44 | 41/44 |
| Unsupported queries returning no sources | 4/6 | 4/6 | 4/6 |
| Mean retrieval latency | 12.89 ms | 12.29 ms | 10.92 ms |
| p95 retrieval latency | 17.10 ms | 18.55 ms | 13.40 ms |
| Embedding fixture calls | 50 | 50 | 50 |
| Additional reranking fixture calls | 0 | 0 | 1 |
| Live provider calls | 0 | 0 | 0 |
| Generated answer groundedness | Unmeasured | Unmeasured | Unmeasured |

Recall, MRR and nDCG exclude the six unsupported questions. Exact references measure whether each returned ID resolves to its original page and excerpt. The separate evidence coverage row requires all grade-2 pages in the first five results. It gives retrieval-level coverage for the expected answer. Claim-level groundedness needs generated answers and human or separately validated assessment. Lens pricing and the date of the first laser printer still retrieved topically related passages that lacked the answer.

The bilingual feature vocabulary was authored from the test readings, so the cross-language score measures an integration fixture. The reranker operated on one query in this run, and its small nDCG gain establishes neither a statistically reliable improvement nor hosted quality. Latency covers local SQL and fixture callbacks and varies with process and database load. The benchmark excludes PDF layout quality, remote provider latency, model drift, real-document language diversity, and unsupported claims in generated answers. The PDF integration suite separately parses representative test files with PDF.js. Route contract tests exercise streaming, citation reconciliation and the no-source response.

## Concurrency run on 23 November 2026

Run `node scripts/check-concurrency.mjs` after `npm run build` and `npm run db:deploy`. Set `FIS_TEST_DATABASE_URL` to a freshly migrated loopback PostgreSQL database named `fis_acceptance_*`. Set `FIS_TEST_GEMINI=1` and `FIS_TEST_BROWSER=1` to exercise the Gemini contract and the Arabic mobile journey. The harness uses real local production routes and PostgreSQL, with controlled provider and Blob HTTP transports.

- **5 concurrent learners**. 5/5 succeeded. Journey p50/p95 was 457/460 ms, tutor response p50/p95 was 201/219 ms, and first-token p50/p95 was 140/173 ms.
- **10 concurrent learners**. 10/10 succeeded. Journey p50/p95 was 718/756 ms, tutor response p50/p95 was 342/407 ms, and first-token p50/p95 was 290/354 ms.
- Neither timed wave encountered provider or application 429s, database errors, failed journeys, or aborts. Separate fixtures intentionally exercised 429, fallback and cancellation. These timings measure the local application under controlled transports. The live Gemini grounded smoke measured 1,502 ms to its first token on a separate single request.

For a hosted evaluation, hold out bilingual questions and annotator-labeled pages from representative courses. Compare vector, hybrid and conditional reranking with identical test cases. Record Recall@K, MRR, citation precision, unsupported-answer abstention, claim-level support, median and p95 retrieval time, time to first token, and end-to-end completion. Record exact model IDs, embedding version, environment, document count and sampling date. Include difficult scans as a separate OCR-required slice.
