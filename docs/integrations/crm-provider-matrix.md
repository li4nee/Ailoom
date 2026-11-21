# CRM connector matrix

> **Verification status:** All eight connectors have provider-specific contact write paths and
> offline fake-transport contract tests. HubSpot passed one direct API contact upsert and one full
> AiLoom-to-HubSpot contact delivery. Only the
> `contacts` capability is advertised; handoff, ticket/case, conversation, and timeline writes remain
> disabled until their provider-specific association and payload contracts are implemented.

AiLoom connectors are one-way event consumers. AiLoom remains the source of truth for visitor
identity and conversation state. A successful offline contract test is not evidence that live
credentials, tenant permissions, or provider account settings work. A connector never receives
prompts, hidden instructions, generation traces, credentials, or provider request snapshots.

| Provider               | Authentication                      | Tenant URL required | Advertised capability | Contact identity and write strategy                | Offline contract | Live smoke                                       |
| ---------------------- | ----------------------------------- | ------------------- | --------------------- | -------------------------------------------------- | ---------------- | ------------------------------------------------ |
| HubSpot                | Service key or OAuth bearer token   | No                  | contacts              | Email batch upsert                                 | Yes              | Direct API and AiLoom delivery succeeded          |
| Salesforce             | OAuth bearer token                  | Yes                 | contacts              | Exact email lookup, then sObject patch or create   | Yes              | Not run                                          |
| Microsoft Dynamics 365 | OAuth bearer token                  | Yes                 | contacts              | Exact email lookup, then Dataverse patch or create | Yes              | Not run                                          |
| Zoho CRM               | OAuth token (`Zoho-oauthtoken`)     | Yes                 | contacts              | v8 upsert with email duplicate check               | Yes              | Not run                                          |
| Pipedrive              | OAuth bearer token                  | No                  | contacts              | v2 exact person search, then update or create      | Yes              | Not run                                          |
| Zendesk                | OAuth bearer or API token via Basic | Yes                 | contacts              | `create_or_update` user endpoint                   | Yes              | Not run                                          |
| Intercom               | OAuth or workspace bearer token     | No                  | contacts              | Create, then update by ID on duplicate conflict    | Yes              | Not run                                          |
| Freshdesk              | OAuth bearer or API key via Basic   | Yes                 | contacts              | Exact email autocomplete, then update or create    | Yes              | Not run                                          |

Tenant URLs must be HTTPS origins (no path, query, fragment, or embedded credentials). Zoho's URL
must use the correct regional API domain for the connected account. Zendesk API-token auth also
requires the account email. Freshdesk API-key auth uses the key as the Basic-auth username and `X`
as the password. Freshdesk defaults to API-key mode when an older saved connection has no auth mode.
HubSpot's full-flow smoke used a synthetic contact, saved the connection in AiLoom, and confirmed a
delivered native CRM event with the provider's external contact ID. It did not read the record back
from HubSpot; see [CRM connector verification](crm-verification.md) for the exact result and limits.

## Safety and delivery behavior

- Provider calls use the `webhook` `safeFetch` policy. Redirects, private destinations, link-local
  addresses, oversized responses, and unsupported ports are rejected.
- Contact payloads are provider-specific and limited to email and name; only Zendesk and Intercom
  include the source external ID in the provider's dedicated identity field.
- Providers without a native idempotency guarantee first search by normalized email where supported.
  A contact with multiple exact matches is rejected rather than arbitrarily updated. Zendesk and
  Zoho use their documented create-or-update/upsert endpoints; Intercom resolves duplicate-create
  conflicts and updates the returned contact ID.
- Authentication failures request reauthentication. Rate limits, timeouts, and 5xx responses remain
  retryable. Unsupported event types are not advertised as capabilities.
- Full transcript sharing is disabled by default and is not part of these contact writes.

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
release criteria.
