# CRM connector matrix

> **Verification status:** All eight connectors have provider-specific contact write paths and
> offline fake-transport contact contract tests. HubSpot passed one direct API contact upsert and one full
> AiLoom-to-HubSpot contact delivery using a private service token. Pipedrive and Intercom each passed
> end-to-end AiLoom contact delivery with provider readback and cleanup. Only the
> `contacts` capability is advertised; handoff, ticket/case, conversation, and timeline writes remain
> disabled until their provider-specific association and payload contracts are implemented.
> OAuth authorization-code redirects are implemented for seven providers. Fake-fetch tests cover
> the authorization and code-exchange endpoint for all seven; token refresh has focused coverage
> for HubSpot. No provider OAuth redirect has a recorded live smoke yet.

AiLoom connectors are one-way event consumers. AiLoom remains the source of truth for visitor
identity and conversation state. A successful offline contract test is not evidence that live
credentials, tenant permissions, or provider account settings work. A connector never receives
prompts, hidden instructions, generation traces, credentials, or provider request snapshots.

| Provider               | OAuth redirect | Other connection option  | Tenant URL required | Contact identity and write strategy                | Adapter contract | Live delivery smoke                              |
| ---------------------- | -------------- | ------------------------ | ------------------- | -------------------------------------------------- | ---------------- | ------------------------------------------------ |
| HubSpot                | Yes            | Private service key      | No                  | Email batch upsert                                 | Yes              | Private-token delivery succeeded                 |
| Salesforce             | Yes            | Manually supplied bearer | Yes                 | Exact email lookup, then sObject patch or create   | Yes              | Not run                                          |
| Microsoft Dynamics 365 | Yes            | Manually supplied bearer | Yes                 | Exact email lookup, then Dataverse patch or create | Yes              | Not run                                          |
| Zoho CRM               | Yes            | Manually supplied bearer | Yes                 | v8 upsert with email duplicate check               | Yes              | Not run                                          |
| Pipedrive              | Yes            | API token or bearer      | No                  | v2 exact person search, then update or create      | Yes              | End-to-end delivery passed; test person deleted  |
| Zendesk                | Yes            | API token via Basic auth | Yes                 | `create_or_update` user endpoint                   | Yes              | Not run                                          |
| Intercom               | Yes            | Private workspace token  | No                  | Create, then update by ID on duplicate conflict    | Yes              | End-to-end delivery passed; test contact deleted |
| Freshdesk              | Not yet        | API key via Basic auth   | Yes                 | Exact email autocomplete, then update or create    | Yes              | Not run                                          |

Tenant URLs must be HTTPS origins (no path, query, fragment, or embedded credentials). Zoho's URL
must use the correct regional API domain for the connected account. Zendesk API-token auth also
requires the account email. Freshdesk API-key auth uses the key as the Basic-auth username and `X`
as the password. Freshdesk defaults to API-key mode when an older saved connection has no auth mode.
HubSpot's full-flow smoke used a synthetic contact and private service token, saved the connection
in AiLoom, and confirmed a delivered native CRM event with the provider's external contact ID. It
did not read the record back from HubSpot and did not use OAuth. See
[CRM connector verification](crm-verification.md) for exact results and limits.

## Safety and delivery behavior

- Provider calls use the `webhook` `safeFetch` policy. Redirects, private destinations, link-local
  addresses, oversized responses, and unsupported ports are rejected.
- Default contact payloads are provider-specific and limited to email and name; only Zendesk and
  Intercom include the source external ID in the provider's dedicated identity field.
- Optional context sync is available for HubSpot, Pipedrive, and Intercom when custom fields are
  mapped during connection. It runs on conversation close, uses the bot's configured chat model and
  spend cap, and sends only mapped summary/classification values. It does not send the transcript
  or context-only events to customer webhooks. See [architecture and setup](architecture.md).
- Providers without a native idempotency guarantee first search by normalized email where supported.
  A contact with multiple exact matches is rejected rather than arbitrarily updated. Zendesk and
  Zoho use their documented create-or-update/upsert endpoints; Intercom resolves duplicate-create
  conflicts and updates the returned contact ID.
- Authentication failures request reauthentication. Rate limits, timeouts, and 5xx responses remain
  retryable. Unsupported event types are not advertised as capabilities.
- Conversation and transcript sharing are not implemented for native CRM connectors. The legacy
  transcript-sharing preference is ignored by delivery code.

## Provider references

- [HubSpot batch upsert](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/objects/batch/upsert-objects)
- [Salesforce sObject upsert](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-sobject-upsert-patch.html)
- [Dataverse upsert](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/use-upsert-insert-update-record)
- [Zoho CRM v8 upsert](https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html)
- [Pipedrive Persons API](https://developers.pipedrive.com/docs/api/v1/Persons)
- [Zendesk Users API](https://developer.zendesk.com/api-reference/ticketing/users/users/)
- [Intercom Contacts API](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts)
- [Freshdesk API](https://developers.freshdesk.com/api/)

See [CRM connector verification](crm-verification.md) for test coverage, live-smoke steps, and
release criteria. For the implementation checklist or custom CRM route, see
[Adding a CRM integration](adding-a-crm.md).
