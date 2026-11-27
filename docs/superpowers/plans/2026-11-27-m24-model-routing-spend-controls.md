# M24 Model Routing and Spend Controls

## Outcome

Give workspace admins a clear way to reduce routine answer cost and enforce both daily and
monthly bot budgets. Keep routing optional, bounded, observable, and safe for tool-enabled bots.

## Existing behavior

- Each bot has one primary chat model and an optional provider-error fallback model.
- The fallback is only for eligible provider failures and must keep that reliability role.
- A nullable monthly spend cap is checked before chat generation; 80% and 100% crossings enqueue
  spend alerts.
- Usage and cost are recorded per UTC day, with provider/model on generation traces.
- Eval runs can override the primary model, but currently do not snapshot a routing policy.

## Scope

1. Add an optional economy model pair (workspace credential plus chat model) for short, simple
   support questions. Existing bots keep their current model unless an admin configures it.
2. Route deterministically from the current visitor message only: a bounded character count and
   a small set of explicit complexity indicators (multi-part questions, long messages, code or
   diagnostic markers) determine whether the economy model is eligible. Never ask a model to
   classify its own request. Tool-enabled bots stay on the configured primary model because model
   tool support may differ. Existing outage fallback remains independent.
3. Select the model before query rewriting so all AI work for the turn uses a consistent selected
   chat model. Persist the selected provider/model in the existing trace and expose a bounded
   routing reason (`primary` or `simple_question`) without storing the question.
4. Add an optional per-bot daily USD cap beside the monthly cap. Evaluate both against UTC usage
   before any model call. At/above either cap, keep the existing configured no-answer/handoff
   behavior and report which cap was reached. No cap remains the default.
5. Expose economy model, daily cap, and routing status in admin controls; validate credentials
   within the same workspace and ensure a selected economy pair is supported for chat. Audit
   setting changes without recording secret or message content.
6. Add M24 settings to evaluation snapshots and baseline compatibility so an eval clearly states
   whether it ran under routing and budget policy. Eval mode may exercise deterministic routing,
   but must never be blocked by live usage caps or create live customer tool calls.
7. Document routing decisions, cap semantics, and limitations in the README and product docs.

## Out of scope

- LLM-based intent classification, arbitrary admin-authored routing expressions, dynamic pricing
  optimization, or automatic changes to configured models.
- Reusing outage fallback as an economy route, changing provider failover conditions, or routing
  tool calls to a model that has not passed existing tool-support validation.
- Hard daily/monthly spend guarantees under simultaneous requests. Usage is metered after
  generation; caps are a preflight guard and concurrent in-flight requests can exceed them.
- Provider-specific token reservations or live budget forecasting.

## Acceptance criteria

- Default settings preserve the existing model and spend behavior.
- An admin can configure or clear the economy model, set/clear the daily cap, and inspect model
  routing state. Non-admin access remains read-only.
- Requests route only under the documented deterministic policy, and traces record actual
  provider/model plus a bounded reason. No visitor text is added to routing telemetry.
- Enabled tools disable economy routing. Provider outages continue using the independent fallback.
- Daily and monthly caps use UTC, block before generation when already reached, and produce
  accurately identified handoff/no-answer behavior. Existing 80%/100% monthly alerts continue;
  daily cap threshold alerts are not introduced in this milestone.
- Eval result snapshots and baseline matching include the economy model, daily cap, and routing
  policy. Eval calls do not consult or mutate live spend caps.
- Database migrations, API/admin/shared types, docs, and the migration/CI checks pass.

## Implementation checklist

- [x] Add bot fields, safe defaults, schema validation, API mapping, audit data, and migration.
- [x] Implement deterministic routing and combined UTC spend-cap preflight for widget, agent
      assist, and CRM model calls.
- [x] Record actual selected model and routing reason in generation traces; keep failure fallback
      attribution accurate.
- [x] Add admin controls for economy model and daily spend cap, including change/clear flows.
- [x] Include settings in evaluation snapshots and comparison eligibility.
- [x] Update README, admin docs, evaluation docs, and spec references.
- [x] Run local typecheck, lint, and production build; all pass. Database-backed migration and
      integration gates remain in PR CI.
- [x] Open PR #46; all required CI checks pass, including unit, integration, database migration,
      browser E2E, retrieval quality, Docker, lint, typecheck, build, audit, and CodeQL. Merge is
      the final release action for this plan.
