# CRM connector verification

## Current confidence

All eight CRM connectors use provider-specific contact request and response handling, with
offline fake-transport contract coverage. The tests check request method, path, authentication,
contact fields, matching/update behavior, and external object IDs. HubSpot passed a live read
check and a direct contact batch-upsert smoke using a private service key. It also passed AiLoom's
full connection, widget identity, outbox, worker, and native delivery path in an isolated local
workspace, again using a private service key. Pipedrive passed a live API-token health check and a
full AiLoom delivery through a saved integration, widget identity, transactional outbox, and
worker. Its synthetic person was read back from Pipedrive and then deleted; the temporary
integration was disconnected. Intercom passed the same saved-connection, widget identity, outbox,
and worker path with a private workspace token; its contact was read back, deleted, and its
temporary integration disconnected. These smokes did not exercise OAuth. The OAuth
authorization-code flow is implemented for seven providers; fake-fetch tests cover the
authorization and token-exchange endpoints for all seven, and token refresh for HubSpot. No OAuth
redirect has been tested against a live app. The other five connectors have not been called
against live CRM accounts.

## Recorded live checks

- **HubSpot, 2026-11-21:** contacts read returned HTTP 200; a direct batch upsert of the synthetic
  contact `ailoom-crm-smoke-20261121@example.com` returned HTTP 200 / `COMPLETE` with external
  contact ID `604412343000`. The request was sent directly to HubSpot using a user-supplied key,
  not through AiLoom's connection form or delivery worker. The user identified the account as a
  developer account; its isolation as a test portal was not independently confirmed.
- **HubSpot through AiLoom, 2026-11-21:** saved a service-key integration in an isolated local
  workspace, and Test connection returned HTTP 200. A synthetic widget identity update flowed
  through AiLoom's transactional outbox and worker; the native CRM delivery row recorded
  `contact.updated`, `delivered`, HTTP 200, and external contact ID `604588848863`. A separate
  `contact.created` event without an email was correctly skipped. The provider record was not read
  back; the other five providers remain unverified against live accounts.
- **Pipedrive API token, 2026-11-23:** saved the token as a temporary integration in the isolated
  CRM-smoke workspace; Test connection passed. A synthetic widget visitor was identified with an
  email, which created a `contact.updated` outbox event. The worker delivered it with HTTP 200 and
  recorded Pipedrive person ID `2`. The anonymous `contact.created` event without an email was
  correctly skipped. A readback matched the synthetic person's name and email; that person was
  deleted and the temporary integration disconnected. This exercised the saved-connection,
  widget identity, outbox, worker, and delivery-record path, but did not test OAuth or event replay.
  API-token requests use Pipedrive's `api_token` query parameter.
- **Intercom private workspace token, 2026-11-23:** the token passed both a read-only `/me` check
  and AiLoom's saved-integration health check. A synthetic widget visitor was identified with an
  email; the resulting `contact.updated` event was delivered through the outbox and worker with
  HTTP 200 and Intercom contact ID `6b03dda74e2855f180ba4901`. The anonymous `contact.created`
  event without an email was correctly skipped. A readback matched the test name and email, and
  Intercom confirmed deletion of the test contact. The temporary integration was disconnected.
  This exercised the saved-connection, widget identity, outbox, worker, and delivery-record path,
  but did not test OAuth or event replay.

- **HubSpot context sync, 2026-11-24:** a temporary service-key integration in the isolated
  CRM-smoke workspace mapped all five context fields to text contact properties
  (`ailoom_summary`, `ailoom_quality`, `ailoom_lead_temp`, `ailoom_buyer_type`,
  `ailoom_evidence`). The bot used a local Ollama `qwen2.5:1.5b` model. A synthetic widget visitor
  was identified, an AI reply streamed, and an agent took over, replied, and closed the
  conversation. The context job completed, and the context-only `contact.updated` delivery returned
  HTTP 200 on its first attempt to the same HubSpot contact as the identity delivery. A readback
  matched all five properties to the generated context. The three synthetic contacts were deleted
  (readback 404), and the temporary integration and model credential were removed. The first two
  runs exposed two defects, both fixed on the same branch before the passing run:
  - The model wrapped its JSON in a Markdown code fence, so the context job failed with a
    `SyntaxError` after retries and nothing was sent. Handoff summaries had the same parser.
  - A second event for an already-linked contact wrote to HubSpot, then failed on the
    `contact_external_links_provider_object_key` unique index. The delivery was recorded as a
    retryable `provider_error`, and every retry rewrote the CRM contact (16 attempts in one run).

  The small local model's classifications were weak (a 40-person agency planning a rollout was
  labelled `consumer` / `cold`). That is a model-quality limit, not a delivery failure; use a
  stronger chat model for production enrichment. Pipedrive and Intercom context mapping are still
  covered only offline.

Each provider currently advertises only `contacts`. Handoff/ticket/case/conversation creation and
close/timeline activity were disabled because the earlier generic payloads did not provide the
provider's required object shape or contact association. Do not describe those operations as
supported until they have their own provider-specific contract tests and delivery verification.

## Provider implementation reviewed

The provider-specific code is based on these API contracts. This source review plus offline tests
does not establish a live API result:

| Provider               | Implemented contact behavior                                                                                                                                                                | Relevant contract                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HubSpot                | Batch upsert by normalized email; maps first and last name; extracts result ID.                                                                                                             | [Batch upsert](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/objects/batch/upsert-objects)                                                                                                                                   |
| Salesforce             | Queries by exact email, rejects ambiguous matches, then patches the matching Contact or creates one with sObject fields. Requires the organization's HTTPS instance URL.                    | [sObject upsert](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-sobject-upsert-patch.html)                                                                                                                                 |
| Microsoft Dynamics 365 | Queries Dataverse contacts by email, rejects ambiguous matches, then patches or creates using logical property names. Requires the environment URL.                                         | [Dataverse upsert](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-upsert-insert-update-record), [alternate keys](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-alternate-key-reference-record) |
| Zoho CRM               | Uses v8 `/Contacts/upsert`, Zoho token authorization, API field names, and email duplicate checking. Requires the appropriate regional API origin.                                          | [Upsert records](https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html), [token and domains](https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html)                                                                       |
| Pipedrive              | Searches v2 persons by exact email, rejects ambiguous matches, then creates or updates using `name` and the `emails` array. Manual API-token auth uses `api_token`; OAuth uses bearer auth. | [Persons API](https://developers.pipedrive.com/docs/api/v1/Persons), [API token auth](https://developers.pipedrive.com/tutorials/adding-leads-to-pipedrive)                                                                                         |
| Zendesk                | Uses `users/create_or_update` with the documented `user` envelope. Supports OAuth bearer auth and API-token Basic auth with account email.                                                  | [Users API](https://developer.zendesk.com/api-reference/ticketing/users/users/), [authentication](https://developer.zendesk.com/api-reference/introduction/security-and-auth/)                                                                      |
| Intercom               | Pins API version 2.18, sends top-level contact fields, and updates by the contact ID returned in a duplicate-create response.                                                               | [Contacts API](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts), [delete contact](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/deletecontact)                                |
| Freshdesk              | Searches exact email through contact autocomplete, rejects ambiguous matches, then creates or updates a contact. Supports API-key Basic auth; OAuth redirect is not implemented.            | [Freshdesk API](https://developers.freshdesk.com/api/)                                                                                                                                                                                              |

Tenant-specific hosts are required for Salesforce, Dynamics 365, Zoho, Zendesk, and Freshdesk. The
connection form stores `authMode`; Zendesk API-token mode also stores the account email. Freshdesk
API-key mode uses Basic auth with `X` as the password. Tenant URLs are validated as HTTPS origins
before requests are made.

## Offline tests

The tests use an injected fake HTTP transport and make no network requests. Run the focused contract
suite and shared delivery tests with:

```sh
pnpm --filter @app/api exec vitest run --project unit src/modules/integrations/connectors/provider-connectors.spec.ts src/modules/integrations/connectors/hubspot/index.spec.ts src/modules/integrations/connectors/rest-crm-connector.spec.ts src/modules/integrations/connectors/connector-catalog.spec.ts src/modules/integrations/integrations.service.spec.ts
```

When adding another provider operation, cover its exact method, URL, headers, body, response ID,
failure classification, and replay behavior. For search-based matching, include zero, one, and
multiple exact-match cases. If a provider's API changes, update the adapter and fixtures together
and record the official source and review date.

Shared outbox and persistence behavior should be tested separately: transaction rollback, retry
without duplicate external mappings, disconnected queued work, authentication reauthorization,
transient retry, sanitized permanent failure, and tenant deletion of credentials and queued data.
The outbox dispatcher also depends on TypeORM's `[rows, affectedCount]` return shape for
`UPDATE ... RETURNING`; a repository unit test covers extracting the claimed rows.

## Live sandbox smoke

Mocks cannot verify credentials, tenant URLs, granted scopes, permissions, or whether the provider
actually persisted a record. Before enabling a connector for a production workspace, test with a
throwaway sandbox/developer account where available:

1. Register a provider OAuth app and set its client ID and secret in `CRM_OAUTH_CLIENTS`; register
   `PUBLIC_URL/v1/integrations/oauth/callback/<provider>` as the redirect URI. Start OAuth from a
   test workspace and confirm the consent screen, callback, saved connection, and granted access.
2. Use **Test connection** to confirm the health check and granted scopes.
3. Send a synthetic contact update and verify the contact and fields in the provider UI/API.
4. Replay the same event and confirm it does not create a duplicate. If it does, implement a safe
   provider-specific deduplication strategy before release.
5. Revoke the test credential and confirm the connection requests reauthentication without
   exposing the credential in logs or API responses.
6. Record provider, API version, date, and result in [the matrix](crm-provider-matrix.md), then
   remove the test contact.

Until a live smoke is recorded, describe the connector as **offline contract-tested**. A single
provider result does not validate the others.

## Delivery visibility

The integration's **Test connection** action is a health check; it does not create a contact. For a
live write check, send a synthetic contact update from a test workspace and verify the record in
the CRM UI/API. AiLoom's native CRM delivery row shows status, attempt count, HTTP status, duration,
sanitized error code, and any external object ID returned. **Delivered** means the provider
returned a successful HTTP response; AiLoom does not read the record back. `contact_external_links`
stores the external mapping when the provider returns an ID for an event with a contact ID.
Outbound webhook history is separate from native CRM history.

## Release gate

- [ ] Run provider-specific offline contract tests and the shared persistence suite in CI.
- [ ] Record one successful live sandbox smoke per provider before calling it live-verified.
- [ ] Keep advertised capabilities limited to implemented and tested operations.
- [ ] Do not claim universal idempotency unless each provider honors it or AiLoom safely deduplicates.
