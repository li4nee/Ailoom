# M21 Retrieval Reranking

Status: Merged to `main`. The reviewed support dataset remains a pilot gate before enabling this feature for a live bot.

## Outcome

Improve which existing knowledge passages reach the answer prompt by optionally reranking a small
hybrid-search candidate set with a local cross-encoder. Preserve the current hybrid order when the
feature is off or the reranker cannot run. Enable the feature per bot only after evaluation.

## Scope

- Add the pinned Transformers.js compatible `Xenova/ms-marco-MiniLM-L-6-v2` model to the existing
  checksum-verified local model fetch flow. The model is a text classifier that scores a query and
  passage together. Keep inference on CPU and inside the API process.
- Retrieve a bounded candidate pool, rerank candidates with `(question, passage)` pairs, and return
  the highest scoring passages. Keep hybrid cosine scores as the knowledge threshold and handoff
  signal. Reranker scores only change order.
- Make reranking opt-in per bot, default off, and record the selected mode and candidate scores in
  traces and eval runs. On missing model files, inference error, timeout, or abort, keep the hybrid
  candidate order and expose a safe diagnostic in the trace.
- Extend **Test retrieval** with before/after ranks, score, and latency. Extend M15 comparison runs
  to compare hybrid against hybrid-plus-reranking using identical eval snapshots.
- Build an anonymized, reviewed 30–50 case support dataset with expected sources and handoff labels
  before enabling a pilot. Do not copy customer messages into this dataset automatically.
- Measure source hit rate, citation accuracy, expected handoffs, p95 retrieval latency, and model
  cost. Keep query rewriting, answer verification, and knowledge-source suggestions out of scope.

## Implementation sequence

1. Add the pinned local cross-encoder to the model manifest, checksum-verified fetch command, and
   lazy local model loader.
2. Add a bounded `Reranker` service and integrate it after hybrid candidate retrieval. Preserve
   vector relevance thresholds and degrade to the original ranking on reranker failure.
3. Add per-bot opt-in configuration, API/shared schemas, migration, audit logging, and trace fields.
4. Add evaluation config snapshots and same-dataset comparison reporting for hybrid versus reranked
   hybrid. Keep comparisons out of unrelated prompt-release evidence.
5. Add the retrieval preview and score/latency reporting to Test retrieval.
6. Add deterministic fixtures for stable tie-breaking, invalid scores, inference failure, and
   timeout fallback. Verify the actual pinned model on CPU with a relevant and an unrelated passage.
7. Compare vector-only, hybrid, and hybrid-plus-reranking using the same saved eval snapshot; the
   comparison baseline matcher accepts a change in either retrieval mode or reranking state.

## Operations and validation

- Opt-in is per bot and defaults off. Reranking runs only after hybrid retrieval, on the API host's
  CPU, over the existing eight-candidate pool. It reorders candidates only: original hybrid scores
  still control knowledge thresholds, handoffs, and selected-source relevance.
- Download the pinned model on each API deployment with
  `pnpm --filter @app/api fetch-model --only ms-marco-MiniLM-L-6-v2`. Runtime inference never
  fetches model files. Missing files, invalid output, inference errors, caller abort, or the 2.5 s
  request budget preserve the original hybrid order; a generic status is visible in retrieval
  previews and traces.
- The local CPU smoke run scored eight passages in 225 ms including model load, with an 84.5 MiB
  process RSS increase in this environment. This is one cold-start sample, not a p95 or a production
  capacity claim. The model adds no provider-token charge; evaluation's normal answer/judge usage
  remains recorded.
- The 30–50 case dataset with reviewed expected sources and handoff labels remains a pilot gate.
  It requires an owner-reviewed, anonymized knowledge corpus and must be run against the M19 hybrid
  baseline before enabling reranking for a live bot. Customer conversations are never copied into
  it automatically.
- Query rewriting, answer verification, and knowledge-source suggestions remain out of scope.

## Model source

The selected Transformers.js ONNX-compatible model is documented at
https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2. The manifest pins revision
`a09144355adeed5f58c8ed011d209bf8ee5a1fec` and SHA-256 checks for every required file.
