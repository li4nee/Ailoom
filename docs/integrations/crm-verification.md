# CRM connector verification

## Current confidence

The integration test suite passes locally (25 tests across 8 files), but that does **not** show
that all listed CRMs work against their APIs. Current connector coverage checks the shared REST
adapter with a fake fetcher, connector registration, and integration-service behavior. It does
not currently exercise provider-specific request/response contracts or live CRM accounts.

All eight provider classes currently inherit the same `RestCrmConnector` behavior. The shared
adapter uses bearer authentication, sends a generic JSON shape for contacts, handoffs, and close
activities, and reads a generic response ID. CRM APIs differ in authentication, endpoint shape,
field names, object associations, idempotency support, and response envelopes. Some configured
base URLs are examples or placeholders. Until each provider has a provider-specific contract and
its connection settings are verified, describe the catalog as **experimental / not provider-
verified**, and do not promise that every capability works.

| Provider               | Offline provider-specific contract | Live sandbox smoke |
| ---------------------- | ---------------------------------- | ------------------ |
| HubSpot                | Not yet recorded                   | Not yet recorded   |
| Salesforce             | Not yet recorded                   | Not yet recorded   |
| Microsoft Dynamics 365 | Not yet recorded                   | Not yet recorded   |
| Zoho CRM               | Not yet recorded                   | Not yet recorded   |
| Pipedrive              | Not yet recorded                   | Not yet recorded   |
| Zendesk                | Not yet recorded                   | Not yet recorded   |
| Intercom               | Not yet recorded                   | Not yet recorded   |
| Freshdesk              | Not yet recorded                   | Not yet recorded   |

## Verification without paid subscriptions

Use three layers. The first two run without CRM accounts and should be required in CI.

### 1. Provider-specific contract tests (offline)

For each connector, derive fixtures from that provider's official API documentation or published
OpenAPI schema. Inject a fake HTTP transport and assert the exact request and response contract:

- API base URL, versioned paths, method, required headers, auth format, and required scopes.
- Contact create/update or upsert behavior, including the actual identity key and field names.
- Handoff and close-event object shape, required associations, and response ID extraction.
- Idempotency behavior. If a provider does not honor an idempotency key, implement and test a
  provider-specific lookup/upsert strategy before claiming replay safety.
- Success envelopes, empty responses, pagination where used, and provider error shapes.
- 401/403 reauthentication, 429 retry/backoff, 5xx and timeout retries, and permanent 4xx
  failures.
- Data minimization: only allowlisted identity fields and explicitly enabled transcript content
  leave AiLoom.

Keep fixtures small and label their source URL and the date they were checked. These tests catch
mapping regressions without credentials or network access, but they cannot prove the provider has
not changed its behavior.

### 2. Shared delivery and persistence tests (offline)

Use the existing database integration-test stack plus fake provider responses to verify the
outbox and worker contract: a rolled-back transaction emits nothing; a retry does not create a
second external mapping; disconnecting skips queued work; auth failure requests reauthentication;
transient errors retry; permanent errors become visible and sanitized; and tenant deletion removes
credentials, mappings, and queued records. Keep one test for each shared rule rather than
duplicating it eight times.

### 3. Small live smoke test (sandbox or free account)

Mocks cannot validate actual credentials, tenant-specific base URLs, permissions, account
configuration, or recent provider API changes. For a provider you plan to advertise as supported,
use its sandbox, developer account, or free trial where available. No paid subscription is needed
for the first two layers, and a live test can be limited to a throwaway account:

1. Connect a test workspace and verify the health check and granted scopes.
2. Send one contact update, one handoff, and one close activity; confirm the created objects and
   associations in the provider UI/API.
3. Replay each same event and confirm whether it is deduplicated. If the CRM creates duplicates,
   the connector must implement its own idempotency before release.
4. Revoke the test credential and confirm the connection requests reauthentication without
   logging or exposing the credential.
5. Delete the test objects and record provider, API version, date, and outcome in the matrix.

If no sandbox or free account is available, keep the provider marked **contract-tested only**;
do not describe it as live-verified. A single provider's sandbox result cannot certify the other
providers because the APIs and permission models differ.

## Release gate

- [ ] Replace the generic connector behavior with provider-specific request and response mapping
      wherever the official API contract requires it.
- [ ] Add and pass provider-specific offline contract tests for each advertised capability.
- [ ] Verify base URL / tenant discovery and credential type per provider; remove placeholder
      defaults from user-facing setup paths.
- [ ] Run a sandbox smoke test where available and record the result in the matrix.
- [ ] Narrow each provider's advertised capabilities to behavior verified by tests.
- [ ] Do not claim universal idempotency unless each provider honors it or AiLoom implements a
      safe provider-specific deduplication strategy.
