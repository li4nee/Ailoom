# Milestone 8 — Contacts, Webhooks, and Multi-CRM Integrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AiLoom integration-ready and support the major sales and customer-support CRM systems through one reliable connector framework: identified widget contacts, a scoped public API, signed webhooks, and native connectors with consistent contact, conversation, handoff, and transcript behavior.

**Product outcome:** A customer can identify visitors from its application, receive conversation events in its own systems, connect the CRM or support platform it already uses, find the AiLoom contact there, and create a timeline entry, ticket, case, or deal activity when a conversation needs a human. The first release is intentionally one-way for CRM data; AiLoom remains the source of truth for conversations.

**Architecture:** spec §9.4, §17, §18, §20, and Phase 4; architecture §3, §8.2, and §10.3. Reuse the existing tenant repositories, encrypted credential storage, pg-boss worker, audit service, `safeFetch` webhook policy, and realtime event vocabulary.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index: `2026-11-09-00-index.md`.

## Scope boundary

This milestone does not build a general CRM synchronization engine. It builds a provider-neutral contract and a broad connector catalog. The supported flow is:

```text
identified widget visitor
        ↓
AiLoom contact + conversation
        ├── signed outbound webhook → any CRM or automation tool
        └── native CRM connector → contact + handoff/timeline/ticket record
```

The initial native connector catalog targets:

- Sales CRM: HubSpot, Salesforce, Microsoft Dynamics 365, Zoho CRM, and Pipedrive.
- Customer-support CRM: Zendesk, Intercom, and Freshdesk.
- Enterprise extensions: ServiceNow and Salesforce Service Cloud through the Salesforce connector where the account has the required objects and scopes.

The following remain out of scope: arbitrary bidirectional message sync, a visual field-mapping builder, automatic overwriting of existing CRM fields, and a multi-provider plugin marketplace. Connectors may ship in sub-releases, but every provider in the catalog must use the same contract tests, security rules, and admin controls.

## Global constraints

All index constraints apply. Milestone-specific constraints:

- Every integration row, API key, delivery, and external mapping is scoped by `workspace_id` and accessed through tenant-safe repository methods.
- OAuth tokens, API keys, webhook signing secrets, and refresh tokens are encrypted at rest with `SecretBox`; plaintext secrets never appear in DTOs, logs, traces, audit details, or delivery errors.
- All outbound CRM and webhook requests use `safeFetch` with the `webhook` policy. No connector may call `fetch` directly.
- All external events are idempotent. Replaying a delivery or retrying a worker job must not create duplicate contacts, tickets, notes, or messages.
- Business records and their outbox records are committed atomically. A rolled-back conversation or handoff must never be delivered externally.
- External systems never receive prompts, provider request snapshots, hidden system instructions, raw generation traces, or API credentials. Transcript sharing is explicit per integration and disabled by default.
- API keys are shown once, stored only as hashes, scoped, revocable, and attributable to a workspace member.
- Provider-specific code stays behind a connector interface. Provider-specific types and mapping logic must not leak into shared contracts or core conversation services.

## Review focus

1. **The visitor replays an identity payload from another workspace.** Expected: the request cannot attach or mutate a contact outside the visitor token's workspace. → Task 8.1.
2. **A transaction rolls back after creating a handoff.** Expected: no webhook, CRM note, or ticket is delivered. → Task 8.4.
3. **The same event is delivered three times.** Expected: one external effect, one delivery record per attempt, and a final idempotent success. → Tasks 8.4–8.6.
4. **A CRM returns `429`, times out, or returns a 5xx.** Expected: bounded exponential retry through pg-boss, safe error recording, and an admin-visible failed delivery after the retry limit. → Task 8.5.
5. **An integration is disconnected while jobs are queued.** Expected: queued work is skipped safely, credentials are revoked/deleted, and no future delivery is scheduled. → Task 8.6.
6. **A workspace is deleted during a sync.** Expected: tenant purge removes integration credentials, mappings, outbox rows, and delivery history without affecting another workspace. → Task 8.7.

---

### Task 8.1: Identified contacts in the widget

**Files:**

- Modify: `packages/shared/src/widget.ts`, `packages/shared/src/conversations.ts`, `packages/shared/src/events.ts`
- Modify: `apps/api/src/modules/widget/{widget-sessions.controller.ts,widget.service.ts,visitor-token.service.ts}`
- Modify: `apps/api/src/modules/conversations/{contacts.repository.ts,conversations.service.ts}`
- Modify: `packages/widget/src/**` (the public widget client API)
- Test: widget unit tests, API integration tests, tenant isolation tests

**Interfaces:**

- Produces `widget.identify({ externalId, email?, name?, attributes? })`.
- Identity is bound to the existing visitor session/token and can only update the current workspace contact.
- Repeated identification with the same `externalId` is idempotent; email/name updates follow an explicit allowlist and do not replace unrelated attributes.
- Anonymous conversations may be identified later. Existing conversation history remains attached to the same contact.
- Emits internal `contact.created` or `contact.updated` events after commit.
- Rejects oversized, non-JSON, or reserved attributes with the normal API error envelope.

- [ ] **Step 1: Write failing tests** — identify an anonymous visitor; identify twice; identify after a conversation exists; reject another workspace's token; enforce limits; verify no secret or raw token is stored in attributes.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Update widget documentation and type declarations.**
- [ ] **Step 6: Commit** — `git commit -s -m "feat(widget): identify contacts for integrations"`

### Task 8.2: Workspace API keys and public API contract

**Files:**

- Create: `apps/api/src/modules/api-keys/{api-key.entity.ts,api-keys.repository.ts,api-keys.service.ts,api-keys.controller.ts,api-keys.module.ts,index.ts}`
- Create: `packages/shared/src/api-keys.ts`
- Modify: `apps/api/src/modules/auth/access.guard.ts` and principal types
- Test: API-key service, authentication, scope, revocation, and isolation integration tests

**Interfaces:**

- Produces workspace-admin routes to create, list, rotate, and revoke keys.
- A raw key is returned only at creation/rotation. The database stores a hash and a short display prefix.
- Authenticated API requests use `Authorization: Bearer <key>` and resolve to a workspace principal.
- Initial scopes: `contacts:read`, `contacts:write`, `conversations:read`, `webhooks:read`, `webhooks:write`, and `integrations:manage`.
- Key metadata includes name, scopes, creator, created time, last-used time, expiration, and revoked time.
- OpenAPI is generated from the shared Zod contracts and published from the same source as the API implementation.

- [ ] **Step 1: Write failing tests** — key creation never returns the hash; revoked/expired keys fail; scopes are enforced; keys cannot cross workspaces; last-used time is updated without creating a write hotspot.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Generate and validate the OpenAPI document.**
- [ ] **Step 6: Commit** — `git commit -s -m "feat(api): add scoped workspace API keys"`

### Task 8.3: Integration connections and credential lifecycle

**Files:**

- Create: `apps/api/src/modules/integrations/{integration.entity.ts,integration-credential.entity.ts,integration-link.entity.ts,integrations.repository.ts,integrations.service.ts,integrations.controller.ts,integrations.module.ts,index.ts}`
- Create: `apps/api/src/modules/integrations/connectors/{connector.ts,connector-registry.ts}`
- Create: database migration for integrations and external links
- Test: integration repository/service integration tests

**Interfaces:**

- Produces an internal connector contract:

```ts
interface IntegrationConnector {
  provider: string;
  connect(input: ConnectInput): Promise<ConnectedAccount>;
  disconnect(connection: IntegrationConnection): Promise<void>;
  test(connection: IntegrationConnection): Promise<ConnectionHealth>;
  handle(event: IntegrationEvent, connection: IntegrationConnection): Promise<void>;
}
```

- Stores provider, connection status, scopes, encrypted credentials, external account ID, and timestamps.
- Supports `active`, `paused`, `reauth_required`, `error`, and `disconnected` states.
- Reuses credential rotation and audit patterns already used by provider credentials.
- Adds `contact_external_links` rather than overloading the existing single `contacts.externalId` field.
- All create/update/delete/test operations are workspace-admin-only and audited.

- [ ] **Step 1: Write migration and failing tests** — tenant isolation, encrypted-at-rest credentials, disconnect cleanup, connector registration, and safe status transitions.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Add OAuth state/CSRF handling and callback tests.**
- [ ] **Step 6: Commit** — `git commit -s -m "feat(integrations): add connector and connection lifecycle"`

### Task 8.4: Transactional event outbox

**Files:**

- Create: `apps/api/src/modules/integrations/{integration-event.entity.ts,outbox.repository.ts,outbox.service.ts,integration-events.ts}`
- Modify: chat persistence, contact writes, agent actions, feedback writes, and workspace purge paths
- Create: migration and pg-boss job definition
- Test: transaction rollback, ordering, idempotency, and purge integration tests

**Interfaces:**

- Produces a versioned, minimal event envelope:

```ts
{
  id: string;
  type: 'contact.created' |
    'contact.updated' |
    'conversation.created' |
    'conversation.updated' |
    'message.created' |
    'handoff.requested' |
    'conversation.closed' |
    'feedback.created';
  workspaceId: string;
  aggregateId: string;
  occurredAt: string;
  version: 1;
  data: unknown;
}
```

- The outbox row is written in the same transaction as the business change.
- A dispatcher claims rows with leases and enqueues delivery work through pg-boss.
- Events contain stable IDs and sanitized business data, not database snapshots.
- Ordering is guaranteed per aggregate where practical; global ordering is not promised.

- [ ] **Step 1: Write failing tests** — commit emits one event; rollback emits none; duplicate registration is ignored; workspace purge removes pending events.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Add dispatcher lease/recovery tests.**
- [ ] **Step 6: Commit** — `git commit -s -m "feat(integrations): add transactional event outbox"`

### Task 8.5: Signed outbound webhooks and delivery log

**Files:**

- Create: `apps/api/src/modules/integrations/webhooks/{webhook.entity.ts,webhooks.controller.ts,webhooks.service.ts,webhook-delivery.job.ts,webhook-delivery.processor.ts,webhook-signature.ts}`
- Create: `packages/shared/src/webhooks.ts`
- Modify: `apps/api/src/common/safe-fetch/policies.ts` only if the existing webhook policy needs an explicit integration limit
- Test: webhook API, signature, retry, timeout, replay, and delivery integration tests

**Interfaces:**

- Produces workspace-admin routes to create, rotate, pause, delete, test, replay, and list webhook deliveries.
- Payloads are HMAC-signed with `X-AiLoom-Event-Id`, `X-AiLoom-Event-Type`, `X-AiLoom-Timestamp`, and `X-AiLoom-Signature`.
- Signature input is `timestamp + '.' + rawBody`; receivers can reject stale timestamps.
- Delivery policy: timeout, response-size limit, retry on timeout/408/409/429/5xx, exponential backoff with jitter, bounded attempts, and dead-letter status.
- Delivery records store status code, duration, attempt count, sanitized error, and timestamps; never the signing secret or full response body.
- URLs are revalidated through `safeFetch` on every attempt to prevent DNS rebinding and private-network access.

- [ ] **Step 1: Write failing tests** — valid/invalid signature; stale timestamp; retry matrix; 429 `Retry-After`; replay; pause; private/link-local URL rejection; delivery log redaction.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Publish webhook verification examples in the docs.**
- [ ] **Step 6: Commit** — `git commit -s -m "feat(webhooks): deliver signed workspace events"`

### Task 8.6: Multi-CRM connector portfolio — contacts and handoffs

**Files:**

- Create: `apps/api/src/modules/integrations/connectors/{hubspot,salesforce,dynamics365,zoho,pipedrive,zendesk,intercom,freshdesk}/`
- Create: provider capability and authentication metadata for the connector registry
- Create: OAuth routes/callback handling under the integrations module, plus API-token/private-app flows where a provider requires them
- Create: `docs/integrations/crm-provider-matrix.md`
- Test: one local fake-server contract suite per provider; connector integration tests with no real network

**Interfaces:**

- Produces a common connector contract with capability flags: `contacts`, `companies`, `leads`, `deals`, `tickets`, `cases`, `conversations`, `timeline`, and `transcripts`.
- Produces OAuth connect/disconnect/test flows with least-privilege scopes and encrypted token storage. Providers that support private app/API-token authentication expose that as an explicit self-hosted option.
- On `contact.created`/`contact.updated`: upserts the provider's contact/person record using the external mapping or normalized email, without overwriting fields outside the configured allowlist.
- On `handoff.requested`: creates one idempotent provider-native work item where supported: ticket, case, conversation, task, or timeline event associated with the contact.
- On `conversation.closed`: adds a compact timeline record with conversation URL, status, handoff reason, and resolution metadata; full transcript upload remains opt-in.
- Full transcript sharing is an explicit integration setting; when enabled, only the visitor/agent transcript is sent, not prompts, traces, or provider payloads.
- Every external object ID is stored in the provider mapping table with an idempotency key.
- A provider error marks the connection `reauth_required` only for authentication failures; transient failures remain retryable. Unsupported capabilities produce a documented no-op, not a failed conversation.

Provider acceptance matrix:

| Provider               | Auth                                          | Primary objects                           | Handoff target    | Minimum release requirement                      |
| ---------------------- | --------------------------------------------- | ----------------------------------------- | ----------------- | ------------------------------------------------ |
| HubSpot                | OAuth; private-app token for self-hosting     | contacts, companies, tickets, timeline    | ticket + timeline | contact upsert, handoff ticket, close timeline   |
| Salesforce             | OAuth                                         | contacts, accounts, leads, cases, tasks   | case + task       | contact/lead match, case creation, timeline/task |
| Microsoft Dynamics 365 | OAuth                                         | contacts, accounts, leads, cases          | case + task       | contact upsert, case creation, close activity    |
| Zoho CRM               | OAuth                                         | contacts, accounts, leads, deals, tasks   | task + note       | contact upsert, handoff task, close note         |
| Pipedrive              | OAuth                                         | persons, organizations, deals, activities | activity + note   | person upsert, handoff activity, close note      |
| Zendesk                | OAuth; API token for self-hosting             | users, organizations, tickets             | ticket            | user match, ticket creation, transcript link     |
| Intercom               | OAuth; workspace access token where supported | contacts, companies, conversations, notes | conversation/note | contact upsert, handoff note, close note         |
| Freshdesk              | OAuth/API key where supported                 | contacts, companies, tickets              | ticket            | contact upsert, ticket creation, transcript link |

- [ ] **Step 1: Define the common capability contract and provider matrix** — each provider declares auth mode, API version, scopes, object IDs, rate-limit behavior, pagination, retryable errors, and deletion behavior.
- [ ] **Step 2: Write fake-server contract tests** — auth exchange/token refresh where applicable, contact match/upsert, provider-native handoff object, close activity, 401/403/429/5xx mapping, pagination, and idempotent replay.
- [ ] **Step 3–6: Implement connectors in provider slices** — HubSpot → Salesforce → Dynamics 365 → Zoho → Pipedrive → Zendesk → Intercom → Freshdesk. Each slice must pass the shared contract before the next starts.
- [ ] **Step 7: Verify no real network is used by CI tests and all calls use `safeFetch`.`
- [ ] **Step 8: Commit** — `git commit -s -m "feat(integrations): add multi-CRM contact and handoff connectors"`

### Task 8.7: Admin integration settings and operational controls

**Files:**

- Create: `apps/admin/src/routes/_app/w/$workspaceId/settings/integrations.tsx`
- Create: integration query/mutation helpers and UI components
- Modify: workspace settings navigation and permission gates
- Test: admin component and API contract tests

**Interfaces:**

- Produces an integrations page with connector cards, connect/disconnect, status, scopes, test connection, pause/resume, and delete.
- Shows recent failed deliveries with event type, timestamp, sanitized reason, and retry/replay controls.
- Clearly labels what data is shared and defaults transcript sharing to off.
- Agents can view integration-derived contact/conversation links but only owners/admins can manage integrations.
- Destructive actions require confirmation and are reflected in the audit log.

- [ ] **Step 1: Write failing component tests** — role gating, disconnected/reauth/error states, failed delivery replay, and transcript-sharing disclosure.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Run admin build and accessibility checks.**
- [ ] **Step 6: Commit** — `git commit -s -m "feat(admin): add workspace integrations settings"`

### Task 8.8: Security, privacy, and documentation gate

**Files:**

- Create: end-to-end integration security tests and a data-sharing checklist
- Modify: `apps/docs/src/content/docs/{widget.md,security.md,configuration.md,faq.md}`
- Modify: `docs/spec.md`, `docs/architecture.md`, `README.md`, `CHANGELOG.md`
- Test: full API/admin/widget suites, dependency/license checks, docs build

**Interfaces:**

- Documents widget identity signing, API key rotation, webhook verification, each connector's OAuth/API-token setup and permissions, retry behavior, disconnection, deletion, and transcript privacy.
- Adds a public integration event reference with payload versions and compatibility rules.
- Adds a launch checklist for the milestone: no secret markers in responses/logs/database exports, cross-tenant isolation, rollback-safe outbox, and successful fake-CRM delivery drill.

- [ ] **Step 1: Write the security tests** — secret leak capture, cross-tenant API key/integration access, OAuth state replay, webhook signature confusion, and purge cleanup.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Build docs and run `git diff --check`, format, lint, typecheck, API tests, admin tests, widget tests, and integration tests.**
- [ ] **Step 6: Demo** — identify a visitor, trigger handoff, observe webhook delivery, and verify contact/timeline or ticket results for representative sales and support connectors using fake servers.
- [ ] **Step 7: Commit** — `git commit -s -m "docs(integrations): document public events and CRM setup"`

## Definition of done

- A signed widget identity can create or update a contact without violating tenant isolation.
- A scoped API key can read permitted contacts/conversations and can be revoked immediately.
- A committed handoff creates exactly one versioned outbox event.
- A webhook endpoint receives signed events, retries transient failures, and exposes replayable delivery history.
- The connector catalog covers HubSpot, Salesforce, Microsoft Dynamics 365, Zoho CRM, Pipedrive, Zendesk, Intercom, and Freshdesk with provider-specific auth and capability documentation.
- Every shipped connector's contact and handoff synchronization is idempotent and tested without real network calls.
- Disconnecting or deleting a workspace removes credentials, mappings, queued work, and delivery history.
- Admin users can understand and control what data leaves the workspace.
- Documentation and OpenAPI are generated/validated in CI.
- CI is green on `main`; the milestone is demoable on the seeded instance; release notes are updated.
