# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Operators deploy and configure the self-hosted support system. Workspace admins configure bots,
knowledge sources, models, and integrations. Support agents handle conversations escalated from AI.
Their customers use the embedded chat widget.

## Product Purpose

AiLoom provides a self-hosted customer-support platform where an AI bot answers from workspace
knowledge and hands conversations to people when needed. The operator deploys the stack and
configures a bot; customers ask for help; agents review and answer handoffs.

## Positioning

AiLoom combines the visitor widget, grounded AI answers, agent inbox, and answer inspection in one
self-hosted stack. Operators can use hosted providers or local models, and inspect the sources and
traces behind AI answers.

## Operating Context

Operators deploy through Docker Compose and configure workspace settings in a browser. Agents triage
urgent and unassigned handoffs, review conversation history, and reply from the inbox. Customers
interact with a small embedded widget inside another website.

## Capabilities and Constraints

The admin includes bot setup, knowledge sources, model/provider configuration, a playground,
conversation handling, saved replies, usage reports, and workspace settings. The widget runs in a
Shadow DOM and supports per-bot name, color, position, handoff, citations, and feedback settings.
Preserve routes, API behavior, workspace permissions, keyboard interaction, responsive behavior,
and widget customization. The project is in public beta; do not introduce unverified product claims
or metrics.

## Brand Commitments

Preserve the AiLoom name. The owner chose charcoal, silver, and lime for this visual redesign. No
separate logo asset or bundled font was found, so the interface uses a system sans stack. Existing
per-bot widget colors remain configurable and are preserved.

## Evidence on Hand

Product evidence includes the README demo at `docs/assets/demo.gif` and admin screenshots at
`docs/assets/screenshot-inbox.png`,
`docs/assets/screenshot-knowledge.png`, `docs/assets/screenshot-replay.png`, and
`docs/assets/screenshot-usage.png`. No approved customer quotes, independent testimonials, or
production usage metrics were found. Demo content must remain clearly illustrative.

## Product Principles

- Keep deployment and data ownership with the operator.
- Make AI answers inspectable and grounded in workspace knowledge.
- Keep people in control of escalations and customer replies.
- Let operators choose hosted or local model providers.

## Accessibility & Inclusion

No product-specific standard was found. Preserve the existing keyboard and focus behavior, visible
focus states, reduced-motion handling, responsive layouts, and semantic labeling in the widget and
admin.
