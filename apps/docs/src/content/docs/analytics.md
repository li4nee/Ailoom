---
title: Conversation analytics
description: How AiLoom defines resolution, handoff, response-time, CSAT, and cost metrics.
---

<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Conversation analytics

The Outcomes report counts conversations created in the selected UTC date range that contain at
least one visitor message. Every metric uses the selected workspace and optional bot filter.
Date ranges are inclusive and limited to 92 days.

| Metric                             | Definition                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations                      | count of the population                                                                                                                                                            |
| Handoff rate                       | `handoff_requested_at IS NOT NULL` / conversations                                                                                                                                 |
| AI-resolved                        | `handoff_requested_at IS NULL` AND ≥ 1 complete `ai` message AND no `ai` message with `feedback = -1` AND (`status = 'closed'` OR `last_message_at < now() - interval '24 hours'`) |
| AI resolution rate                 | AI-resolved / (conversations that are AI-resolved or handed off). Open conversations still inside the 24 h window are excluded from the denominator and reported as "pending".     |
| First human response (median, p90) | for handed-off conversations: first `agent` message `created_at` − `handoff_requested_at`; conversations with no agent reply are counted as "unanswered", not as zero              |
| Resolution time (median, p90)      | for handed-off conversations that are closed: `closed_at` − `handoff_requested_at`                                                                                                 |
| CSAT                               | share of ratings ≥ 4 among rated conversations, plus average score and response rate (rated / closed)                                                                              |
| Cost per resolved conversation     | `sum(generation_traces.cost_usd)` for the population's conversations / (AI-resolved + closed handed-off). Includes agent-assist traces; excludes playground.                       |

## How CSAT is collected

When a conversation closes, the widget can ask the visitor for one rating from 1 to 5 and an
optional comment. The prompt is controlled by the bot's **Ask for a rating when a conversation
closes** setting. A visitor may dismiss the prompt. A submitted rating remains attached to that
conversation if it is reopened, and a conversation accepts only one rating.

## The 24-hour pending rule

An AI-only conversation is resolved after it closes, or after its last message has been idle for
24 hours, provided it has a complete AI answer and no AI thumbs-down. An open conversation inside
that window is pending. Pending conversations are not included in the AI resolution rate
denominator.
