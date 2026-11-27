---
title: Answer verification
description: Hold a bot's draft until its configured chat provider checks it against the evidence.
---

Answer verification is an optional per-bot safety check. It is off by default. When enabled, AiLoom
holds the generated draft and asks the bot's configured chat provider whether its factual claims are
supported by the knowledge passages and visitor-visible tool fields used for that answer.

Open **Bot settings → Behavior → Retrieval quality** and enable **Verify answer support before
showing it**. The Evaluate page has the same run-only option, so an admin can compare runs before
changing a live bot.

## What visitors see

- If the check returns a valid supported verdict, AiLoom releases the answer and its normal
  citations.
- If the check finds unsupported claims, returns invalid output, times out, or is unavailable,
  AiLoom discards the draft and uses the bot's configured no-answer behavior. Depending on that
  behavior, the visitor sees a fallback message or a handoff offer.
- If the visitor disconnects while verification is running, the request is cancelled.

The verified path buffers the answer until the check finishes, so visitors see the normal progress
state longer. Verification makes an additional provider request and adds its token usage to the
trace, workspace usage, and evaluation cost. It can still make mistakes; keep it off until an
owner-reviewed support dataset shows acceptable quality, handoff rate, latency, and cost.

## Data handling

The verification request contains the current visitor message, draft answer, up to five retrieved
passages, and only scalar tool-result fields configured as visible to the visitor. The configured
chat provider receives that material. AiLoom does not save the verifier's prompt, response, or
unsupported-claim text. Traces record only the verdict category, duration, and normal usage totals.
See [Data handling](/data-handling/) and [Bot API tools](/tool-calling/) for provider and tool data
boundaries.

Evaluation results report the verification status and duration for each case, plus an aggregate
pass rate. Existing citation accuracy continues to measure whether cited documents match the
case's expected documents; it is a separate metric from the verifier's grounding verdict.
