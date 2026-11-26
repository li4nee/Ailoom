# M19 Hybrid retrieval

Status: Implementation complete on branch `m19`; pilot validation is pending a representative
support dataset.

## Outcome

Give each bot a choice between **Semantic search** (the current vector search) and
**Hybrid search** (semantic plus keyword search). An admin can compare both approaches using an
M15 dataset before changing the live setting. Existing and new bots start with semantic search.

The quality question is whether hybrid search finds better sources for product names, codes,
and exact terms while preserving results for paraphrases and questions the bot should hand off.
Measure this against the existing semantic search with the same dataset and bot configuration.

## 1. Establish the baseline

- Use the existing RAG fixtures for paraphrases, follow-ups, and out-of-scope questions. Add a
  focused comparison dataset with labelled sources for exact names and identifiers, similar
  identifiers in unrelated documents, and out-of-scope queries that contain common terms.
- Capture the semantic results with the current eight-candidate and five-source limits. Record
  the corpus, embedding model, relevance threshold, and case counts for the comparison.
- Use the existing retrieval latency harness as the starting point. Seed text with both rare and
  common terms so the benchmark exercises the GIN index and the cost of ranking common matches.

## 2. Implement keyword search and fusion

- Extend `RetrievalRepository` with a hybrid path that reuses `chunks.tsv` and
  `chunks_tsv_gin`. Both searches must scope by workspace, bot, current document version,
  and the active embedding model and dimension. Verify stale, deleted, and superseded content
  remains ineligible. The full-text index already exists. A migration is needed for the bot setting.
- Start with eight candidates per search. Use the existing retrieval query for both branches,
  including its follow-up context. Bind the text as a SQL parameter and derive a bounded OR of
  normalized terms with PostgreSQL's `simple` configuration. Treat user text as plain text and
  rank matches with `ts_rank`. Empty lexical input or zero lexical matches uses the vector
  ordering. Check term selection on multiword questions, punctuation, and product codes.
- Merge by chunk ID using reciprocal rank fusion. Add `1 / (60 + rank)` for each list in
  which a chunk appears, using one-based ranks. Use cosine similarity and chunk ID to break
  ties deterministically. Keep eight returned candidates and at most five sources in the answer.
- Keep cosine similarity as the relevance score and calculate it for keyword candidates too.
  Apply the existing threshold before limiting qualifying results, then order qualifying chunks
  by fused rank. Low-scoring candidates can fill remaining diagnostic slots in Test retrieval.
  Compute the escalation score from the maximum cosine similarity, since the first fused result
  might have a lower score. This version can find a qualifying chunk outside the original eight
  vector candidates. A keyword match below the cosine threshold cannot become answer evidence.
- Reuse one query embedding per request. Both searches see the same published knowledge state
  by using a single statement or a shared database snapshot. Check query plans and measure
  database time against the existing 100k-chunk benchmark.

## 3. Wire up the bot and admin controls

- Add `retrievalMode: 'vector' | 'hybrid'` to the bot entity, migration, shared request/response
  schemas, service, and mapper. Default it to `vector` in the database and API, and audit setting
  changes through the normal bot update path.
- Use the selected mode in the shared retrieval path for chat, playground, and Test retrieval.
  Add the setting and an unsaved preview override to the existing retrieval panel so an admin
  can try either mode on a single question before saving. Display the applied mode and distinguish
  cosine similarity from the rank used to order results. Pass a preview threshold to the server
  when testing hybrid, so lowering the threshold can surface candidates outside the previous
  eight results.
- Record the applied mode and candidate ranks in the trace so admins can explain why a source
  appeared. Keep historical traces readable. Switching back to semantic search is the rollback
  and requires no reindex or re-embedding.

## 4. Compare modes through M15 Evaluate

- Let an admin select a search mode for an evaluation without changing the bot. Snapshot it in
  the eval run configuration and pass it to the worker and chat orchestrator. Existing runs with
  no recorded mode use `vector`.
- Start a semantic comparison run, then select it as the baseline for a hybrid run. Use the same
  saved dataset cases and expectations, prompt version, chat and judge settings, embedding
  configuration, tool fixtures, and relevance threshold. Require a completed baseline for the
  same bot and dataset. Reuse its case snapshot and check that configuration and published document
  versions still match. Mark the comparison inconclusive if those inputs change during a run.
- Keep comparison runs separate from prompt release evidence. Ordinary evals default to the live
  mode. Update the M18 gate and automatic baseline lookup to match the live mode and exclude
  dedicated comparison runs, without invalidating eligible historical vector runs.
- Show both runs' hit@K for sources used in the answer, MRR for retrieved candidates, citation
  accuracy, pass rate, and handoff outcomes. Report changed cases in both directions and show
  sample counts so a metric based on sparse labels is identifiable.
- Measure retrieval time (embedding plus search) separately from total chat latency. Report p50
  and p95 for both. Show query embedding cost alongside total eval cost (including judge cost),
  using the existing accounting and representing unknown prices explicitly.

## 5. Verify and decide whether to enable

- Cover default vector behavior, deterministic fusion and deduplication, empty lexical results,
  relevance thresholds and handoff, document and tenant isolation, re-embedding transitions,
  API permissions, eval snapshots, and M18 gate compatibility.
- Run both modes on the same fixture corpus and a representative support dataset. Report the
  per-case deltas and use the project's existing database search target of p95 below 50 ms at
  100k chunks on its reference setup. Review any extra end-to-end latency or cost before rollout.
- Ship hybrid as opt-in. Enable it for a pilot bot only after it improves labelled retrieval
  for exact terms and preserves expected handoffs and acceptable results on the broader dataset.
  Publish the comparison results and the rollback steps with the implementation.

## Follow-up milestones

Evaluate reranking and query rewriting in a separate milestone. Measure each independently on top
of the M19 baseline. Follow with answer verification and knowledge-gap reporting. Plan PII controls
before expanding the customer data sent to tools or models.

## Implementation progress

- [x] Add the per-bot retrieval mode with a database/API default of `vector`.
- [x] Reuse the generated PostgreSQL `tsv` column and GIN index for bounded keyword candidates.
- [x] Fuse vector and keyword candidates with RRF, preserving cosine thresholds and deterministic
      tie-breaking. Keep qualifying chunks ahead of diagnostic-only candidates.
- [x] Add a single-question admin mode preview and persist the chosen bot mode through the normal
      audited bot update path.
- [x] Snapshot retrieval mode in evaluation runs, mark mode comparisons, and keep those comparison
      runs out of automatic baselines and prompt-release gate evidence.
- [x] Require matching cases, prompt, chat, judge, threshold, tools, and embedding settings when
      selecting an automatic evaluation baseline.
- [x] Let an admin select a completed opposite-mode run as the comparison baseline; validate that
      its cases, prompt, model settings, tools, embedding configuration, and knowledge snapshot
      match before enqueueing the run.
- [x] Cover opposite-mode baseline selection in the admin UI regression tests.
- [x] Keep selected comparison runs out of automatic baselines and prompt-release evidence; add
      integration coverage for baseline eligibility and prompt-gate compatibility.
- [x] Execute vector and hybrid M15 cases end to end on the exact-identifier fixture. The run
      records comparable summaries; hybrid improves hit@5 and MRR without lowering citation
      accuracy. Fix trace retrieval field decoding so eval metrics read the persisted trace format
      correctly.
- [x] Snapshot published document versions and embedding configuration in eval runs. Mark a run
      inconclusive if either changes before its cases finish; keep it out of baselines and gates.
- [x] Record retrieval mode/rank provenance, retrieval latency, and query embedding price
      separately in traces and evaluation summaries.
- [x] Extend the 100k-chunk benchmark to measure vector and hybrid search and add exact product
      identifiers with a near-match distractor to the RAG fixture corpus.
- [x] Run repository retrieval integration and RAG comparison suites. Exact-identifier hits did
      not regress and hybrid handoff decisions did not regress on the focused fixture set.
- [x] Compare vector and hybrid on the existing 20 in-scope and 10 out-of-scope FAQ questions.
      Source recall, in-scope answer decisions, and out-of-scope handoffs all met the no-regression
      checks using chat's maximum-cosine escalation rule.
- [x] Run the 100k-chunk benchmark in a temporary PostgreSQL 18 container constrained to 2 vCPU
      and 4 GB. Vector p95 was 6.20 ms and hybrid p95 was 13.94 ms, both below 50 ms.
- [ ] Run a full M15 evaluation comparison on a representative support dataset before enabling a
      pilot bot. The synthetic exact-identifier fixture comparison and prompt-gate compatibility
      checks pass; a representative support dataset is not available in this workspace.

## References

- [M15 eval suite](2026-11-24-m15-eval-suite.md) and [M18 prompt release](2026-11-26-m18-prompt-release.md).
- [PostgreSQL full-text search and ranking](https://www.postgresql.org/docs/18/textsearch-controls.html).
- [Original reciprocal rank fusion paper](https://cormack.uwaterloo.ca/cormack/cormacksigir09-rrf.pdf).
