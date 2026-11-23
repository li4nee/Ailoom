---
title: Integrations
description: Workspace API keys, signed webhooks, and one-way CRM synchronization
---

# Integrations

Integrations are configured per workspace by an owner or admin. AiLoom remains the source of
truth for its contacts and conversations. Native CRM connectors send identified contact updates
outward; they do not import CRM records, create tickets or cases, send handoff work items, or
share transcripts.

> **CRM connector status:** Seven connectors have offline fake-transport contract tests. HubSpot
> has one recorded live contact delivery using a private service token; the OAuth redirect flow
> is implemented but not live-tested. Passing automated tests alone does not prove a live account
> is configured correctly. **Test connection** is a read/health check, not a CRM write. See the
> [provider matrix](https://github.com/li4nee/ailoom/blob/main/docs/integrations/crm-provider-matrix.md)
> and the [architecture walkthrough](https://github.com/li4nee/ailoom/blob/main/docs/integrations/architecture.md).

## Data sharing

- Provider credentials and webhook signing secrets are encrypted at rest and never returned after
  creation.
- Native CRM contact writes contain email and name; Zendesk and Intercom also map the source
  external ID. Other arbitrary contact attributes are not sent.
- Prompts, hidden instructions, generation traces, provider request snapshots, and credentials are
  never sent to a CRM or webhook endpoint.
- Native CRM connectors do not send conversation transcripts, agent messages, private notes,
  handoffs, tickets, or timeline activities. The legacy transcript-sharing preference is not an
  active delivery feature.
- Disconnecting a connection deletes its encrypted credentials and skips queued work. Deleting a
  workspace removes its integrations, mappings, outbox events, webhook deliveries, and secrets.

## Native CRM contact connectors

The OAuth button starts a server-side authorization-code redirect for HubSpot, Salesforce,
Dynamics 365, Zoho, Pipedrive, Zendesk, and Intercom. The instance operator must register each
provider app and set its client ID and secret in `CRM_OAUTH_CLIENTS`; the provider's redirect URI
must exactly match `PUBLIC_URL/v1/integrations/oauth/callback/<provider>`. Freshdesk currently
uses API-key authentication. The form also accepts manually created credentials for
self-hosted/private-app use where the provider permits it.

| Provider               | OAuth redirect | Private/API credential  | Live contact delivery evidence                         |
| ---------------------- | -------------- | ----------------------- | ------------------------------------------------------ |
| HubSpot                | Yes            | Service key             | One private service-token smoke; OAuth not live-tested |
| Salesforce             | Yes            | Bearer token accepted   | Not run                                                |
| Microsoft Dynamics 365 | Yes            | Bearer token accepted   | Not run                                                |
| Zoho CRM               | Yes            | Bearer token accepted   | Not run                                                |
| Pipedrive              | Yes            | Bearer token accepted   | Not run                                                |
| Zendesk                | Yes            | API token               | Not run                                                |
| Intercom               | Yes            | Private workspace token | Not run                                                |
| Freshdesk              | Not currently  | API key                 | Not run                                                |

All provider calls use `safeFetch`. Expiring OAuth tokens are refreshed before use when a
refresh token is available. Authentication failures request reauthorization; timeouts, rate
limits, and provider server errors are retryable. The **Test connection** action is a read/health
check. A delivered event means the CRM returned a successful HTTP response; verify the record in
the CRM itself when validating a live setup.

## Signed webhooks

Create a webhook in **Workspace → Settings → Integrations**. The signing secret is shown only at
creation or rotation. Every delivery includes:

```text
X-AiLoom-Event-Id
X-AiLoom-Event-Type
X-AiLoom-Timestamp
X-AiLoom-Signature: sha256=<hex digest>
```

The signature is HMAC-SHA256 over `timestamp + '.' + rawBody`. Verify the timestamp is recent
(the default receiver tolerance is five minutes) before accepting the event. Verify the exact raw
request body, not a re-serialized JSON object.

The payload is a versioned envelope:

```json
{
  "id": "018f…",
  "type": "handoff.requested",
  "workspaceId": "018f…",
  "aggregateId": "018f…",
  "occurredAt": "2026-01-01T00:00:00.000Z",
  "version": 1,
  "data": { "conversationId": "018f…", "contactId": "018f…" }
}
```

Delivery retries cover timeouts, 408, 409, 429, and 5xx responses with bounded exponential
backoff. Delivery history stores status, response code, duration, attempts, and a sanitized error;
it never stores the signing secret or full response body. Failed deliveries can be replayed from
the admin page.

## Workspace API keys

API keys are shown once, stored as hashes, and scoped to one workspace. Use them as:

```text
Authorization: Bearer ak_live_…
```

Available scopes are `contacts:read`, `contacts:write`, `conversations:read`,
`conversations:write`, `webhooks:read`, `webhooks:write`, and `integrations:manage`. Revoke or
rotate a key immediately when it is no longer needed. Browser session authentication remains the
recommended method for the admin UI.

## Widget identity

`AiloomChat.identify()` is bound to the widget's signed, workspace-bound visitor token. It can only
update the current visitor and cannot attach a contact from another workspace. The host
application should call it only after its own authentication check and should send verified
customer data. Do not put a workspace API key or provider credential in browser code.

See [Widget](/widget/), [Security](/security/), and the internal
[CRM provider matrix](https://github.com/li4nee/ailoom/blob/main/docs/integrations/crm-provider-matrix.md)
for setup and provider-specific details.
