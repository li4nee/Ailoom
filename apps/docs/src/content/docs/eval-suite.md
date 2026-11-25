---
title: Evaluation suite
description: Build test datasets, run bot evaluations and protect prompt activation with an eval gate.
---

The evaluation suite measures a bot against a saved set of questions before you change its prompt, model or retrieval settings. Runs use the normal chat pipeline, save a trace for each answer and keep a snapshot of the dataset so later edits do not change earlier results.

## Create a dataset and run it

Open a bot and choose **Evaluate**. Create a dataset, then add cases with a question and an expected answer. A case can also check expected knowledge document IDs, phrases that must appear or must not appear, and whether the bot should hand off. Cases marked as needing an expectation are useful for collecting feedback, but add an expectation before starting a run.

Choose a judge credential and model, then start a run. You can save a prompt version as a draft from the Instructions tab and select it for an evaluation through the API. The active bot configuration is used for settings that are not overridden. Runs are asynchronous; status and progress appear in the run list. Select a run to inspect answers, costs, timings and traces.

## Metrics

- **hit@k** is 1 when an expected document appears among the retrieved chunks used in the answer prompt; otherwise it is 0. Deleted expected documents are flagged stale and excluded from the aggregate.
- **MRR** is the reciprocal rank of the first expected document among the top eight retrieved documents.
- **Citation accuracy** is the fraction of citations that reference an expected document. It is omitted when the answer has no citations.
- **Must include / must not include** checks compare normalized text (case and repeated whitespace do not matter).
- **Escalation accuracy** checks whether the bot's escalation decision matches the case expectation.
- **Judge score** is an LLM assessment from 0 to 1. The rubric labels an answer correct, partially correct or incorrect based on factual support and contradictions.
- **Pass rate** is the share of cases that pass every check configured for that case. Partial judge answers pass only when the dataset allows partial answers.

Run summaries show means only for cases with the corresponding expectation, along with total cost and p50/p95 latency. Each case result includes its individual metrics and judge rationale.

## Judge and cost

The judge uses the versioned `eval-judge-v1` prompt, temperature zero and a 300-token output limit. Case text, expected answers and source excerpts are treated as untrusted input. Source excerpts are capped at 6,000 characters. Invalid judge output is retried once; a second failure is recorded as `judge_error` and does not stop other cases.

Evaluation uses your configured chat and judge providers and incurs their normal usage cost. Costs are recorded on traces and runs and count toward the bot's monthly spend cap. A run is capped at 500 cases, datasets are capped at 500 cases, only one run per bot can be active, and a workspace can have up to three active runs. Runs older than 180 days are eligible for retention cleanup, except the latest completed run per dataset and gate evidence.

The repository includes 20 hand-labelled fixtures for judge behavior. A live-provider agreement score is model-dependent and is not claimed here until the live calibration workflow has been run and its result recorded.

## Prompt activation gate

An admin can configure a dataset, minimum pass rate and maximum regression on the Evaluate tab. Activating a prompt then requires a completed run for that prompt and dataset from the last seven days. The run must meet the minimum pass rate and remain within the allowed regression from its baseline. A workspace owner can override a failed gate by supplying a reason; the override is written to the audit log.

## Import and export

Datasets can be exported through `GET /v1/workspaces/{workspaceId}/bots/{botId}/eval/datasets/{datasetId}/export` as versioned JSON:

```json
{
  "format": "ailoom-eval-dataset",
  "version": 1,
  "cases": [
    {
      "question": "How long do refunds take?",
      "expectedAnswer": "Refunds are processed within five business days.",
      "expectedDocumentIds": [],
      "mustInclude": [],
      "mustNotInclude": [],
      "history": [],
      "needsExpectation": false,
      "origin": "manual"
    }
  ]
}
```

Import accepts that format and the repository's RAG fixture format. In RAG fixtures, document titles are mapped to document IDs; unknown titles are returned as validation errors. An `outOfScope` fixture becomes a case that expects handoff.
