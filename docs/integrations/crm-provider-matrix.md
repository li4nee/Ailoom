# CRM connector matrix

> **Verification status:** The current connector catalog is experimental. The shared adapter
> tests do not certify any provider's live API contract. See
> [CRM connector verification](crm-verification.md) for the evidence required before calling a
> provider supported.

AiLoom connectors are one-way event consumers. AiLoom remains the source of truth for visitor
identity and conversation state. A connector may upsert an external contact, create a provider
work item for a handoff, and append a compact close activity. It never receives prompts, hidden
instructions, generation traces, credentials, or provider request snapshots.

| Provider               | Authentication                   | Contact object | Handoff object | Close activity          | Capabilities in M8                                        |
| ---------------------- | -------------------------------- | -------------- | -------------- | ----------------------- | --------------------------------------------------------- |
| HubSpot                | OAuth or private-app token       | contact        | ticket         | note                    | contacts, companies, tickets, timeline                    |
| Salesforce             | OAuth                            | Contact        | Case           | Task                    | contacts, companies, leads, cases, timeline               |
| Microsoft Dynamics 365 | OAuth                            | contact        | incident/case  | task                    | contacts, companies, leads, cases, timeline               |
| Zoho CRM               | OAuth                            | Contact        | Task           | Note                    | contacts, companies, leads, deals, timeline               |
| Pipedrive              | OAuth                            | person         | activity       | note                    | contacts, companies, deals, timeline                      |
| Zendesk                | OAuth or API token               | user           | ticket         | ticket comment/activity | contacts, companies, tickets, transcripts                 |
| Intercom               | OAuth or workspace token         | contact        | conversation   | note                    | contacts, companies, conversations, timeline, transcripts |
| Freshdesk              | OAuth or API key where supported | contact        | ticket         | ticket note             | contacts, companies, tickets, transcripts                 |

## Common behavior

- All provider calls use the `webhook` `safeFetch` policy. Redirects, private destinations, link-local
  addresses, oversized responses, and unsupported ports are rejected.
- Every event sends an `Idempotency-Key` equal to the stable AiLoom event id. Replaying a job is
  therefore safe for providers that honor idempotency; the external mapping table prevents a
  second AiLoom mapping for the same integration/event.
- Contact payloads are limited to the configured identity allowlist: external id, email, and name.
  Arbitrary contact attributes are not copied into provider fields.
- Authentication failures move the connection to `reauth_required`. Rate limits, timeouts, and 5xx
  responses remain retryable. Unsupported capabilities are successful no-ops.
- Full transcript sharing is disabled by default and is a separate integration setting. When enabled,
  only visitor/agent messages are eligible; prompts and generation traces are never included.

## Test contract

Provider contract tests use local fakes and never real CRM hosts. Each adapter must cover contact
upsert, handoff creation, close activity, idempotent replay, pagination where the provider endpoint
requires it, and 401/403/429/5xx classification before a live credential is enabled.
