# M26: Agent operations

## Outcome

Help support teams get human conversations to the right available agent and see when a response
or resolution is at risk. Policies are explicit, deterministic, workspace-scoped, and visible to
admins; the AI never assigns agents or changes SLA policy.

## Existing behavior

- Agents can manually assign or release conversations, set priority, take over, reply, and close.
- Handoff notifications and live workspace invalidation already exist.
- First-response and resolution times are historical analytics only.
- Workspace members have owner/admin/agent roles, but no presence state or capacity.

## Scope

1. Add agent presence states `online`, `away`, and `offline`, controlled by each member, with a
   short server-enforced lease so abandoned sessions become offline. Presence is workspace-scoped;
   admins can inspect it, but cannot silently set an agent's availability.
2. Add workspace routing policy with enable/disable, `round_robin` or `least_loaded` selection,
   maximum open assigned conversations per agent, and an explicit fallback to the unassigned
   queue. Only online members below capacity are eligible. Route human handoffs after their
   database transaction commits; manual assignment always takes precedence. Selection and cursor
   updates must be safe under concurrent handoffs.
3. Add admin-configured response and resolution targets per priority, plus an IANA timezone and
   weekly business-hours schedule. An empty schedule means always-on. Count elapsed business time;
   holidays are out of scope. Response timing begins at human handoff, response ends on the first
   agent reply, and resolution ends when the conversation closes.
4. Add a worker-owned periodic SLA processor. Persist breach timestamps to make notifications and
   audit events idempotent. Breaches notify the configured workspace admins/owners and leave the
   conversation visible in the inbox; they do not automatically close or reassign it.
5. Add an Operations settings page for admins, a presence control and SLA indicators in the inbox,
   role-checked APIs, audit events, shared schemas, migrations, and documentation.
6. Keep the existing manual inbox workflow as the default: auto-routing disabled, all agents
   offline until they opt in, and no SLA targets until an admin configures them.

## Out of scope

- Skills-based or AI-based assignment, routing expressions/scripts, cross-workspace assignment,
  assignment of away/offline members, and automatic SLA reassignment.
- Holiday calendars, custom pause conditions, multiple escalation tiers, on-call schedules,
  external paging integrations, and WebSocket presence. The current SSE/polling model is enough.
- Guaranteed zero-overrun at concurrent boundaries; SLA processing is at-least-once and
  idempotent, with minute-level precision.

## Implementation sequence

1. Define strict shared contracts for presence, routing policy, business hours, SLA targets, and
   their API DTOs. Add coverage for bounds, timezones, invalid schedules, and defaults.
2. Add persistence and reversible migration for agent presence leases, workspace policies, and
   per-conversation breach markers. Keep all data workspace-scoped and add indexes for due SLA
   scans.
3. Implement self-presence APIs, admin policy read/write APIs, and audit trails. Reject setting
   policies unless the caller is an owner/admin; agents can update only their own presence.
4. Implement deterministic handoff routing with eligibility, capacity counts, and the round-robin
   cursor serialized by a workspace row lock. Leave the handoff unassigned when no agent qualifies.
5. Implement business-time deadline calculation, a worker-only minute schedule, idempotent breach
   recording, and notifications. Do not run recurring work from API-only processes.
6. Add admin controls and inbox visibility with pending/loading/empty/error states, keyboard
   access, mobile layout, and truthful copy for presence leases and SLA timing.
7. Update README and docs. Run shared/API/admin tests, migration check, integration/E2E/browser
   tests, lint, typecheck, build, and CI. Record any infrastructure-only validation limits.

## Acceptance criteria

- Existing workspaces preserve manual assignment; routing and SLA features are inactive by default.
- Presence updates cannot target another user's ID and expire server-side after the documented
  lease. A user outside the workspace cannot read or modify presence.
- Only eligible online members under capacity receive an automatic handoff; round-robin is fair
  across successful assignments, least-loaded ties are deterministic, and simultaneous handoffs
  cannot exceed a member's configured capacity.
- Admins can configure bounded targets and valid weekly schedules. Agents cannot change policies.
- Business-time calculation covers DST transitions and overnight schedule boundaries. Unconfigured
  target values stay inactive; an empty weekly schedule means 24/7.
- Each response/resolution breach is persisted once and creates at most one alert/audit event.
  Human reply and close stop their respective timers, and late processing still reports correct
  breach state.
- README and docs describe defaults, routing eligibility, lease expiration, SLA clock semantics,
  and exclusions accurately.
- Required CI checks pass and PR #49 is merged.

## Progress

- [x] Branch `feat/m26-agent-operations` from current `main`.
- [x] Shared contracts, tests, persistence and migration.
- [x] Presence and policy APIs with role and tenant-isolation tests.
- [x] Deterministic routing and concurrent capacity tests.
- [x] Business-time SLA calculation, worker, notifications, and idempotency tests.
- [x] Admin settings and inbox UX.
- [ ] Documentation, full validation, PR #49, and merge.
