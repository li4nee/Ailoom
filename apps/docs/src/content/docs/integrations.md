---
title: Integrations
description: Workspace API keys, signed webhooks, and one-way CRM synchronization
---

# Integrations

Integrations are configured per workspace by an owner or admin. AiLoom remains the source of
truth for contacts and conversations; CRM connectors send contact updates, handoff work items,
and compact close activities outward. They do not import messages or overwrite unrelated CRM
fields.

> **CRM connector status:** Treat the CRM catalog as experimental until the provider-specific
> contract and sandbox checks are recorded in the [verification matrix](https://github.com/li4nee/ailoom/blob/main/docs/integrations/crm-verification.md).
> Passing the shared automated tests alone does not confirm compatibility with a live CRM API.
> The **Test connection** action checks reachability and authorization; it does not verify a CRM
> write. Confirm test records in the CRM itself. Native CRM event history is not currently shown
> in AiLoom.

## Data sharing

- Provider credentials and webhook signing secrets are encrypted at rest and never returned after
  creation.
- CRM contact mappings include only the configured identity fields: external ID, email, and name.
- Prompts, hidden instructions, generation traces, provider request snapshots, and credentials are
  never sent to a CRM or webhook endpoint.
- Transcript sharing is disabled by default. When explicitly enabled for a CRM connection, only
  visitor and agent messages are eligible for sharing.
- Disconnecting a connection deletes its encrypted credentials and skips queued work. Deleting a
  workspace removes its integrations, mappings, outbox events, webhook deliveries, and secrets.

## CRM connectors

| Provider               | Authentication                   | Contact      | Handoff      | Close activity  |
| ---------------------- | -------------------------------- | ------------ | ------------ | --------------- |
| HubSpot                | OAuth or private-app token       | contact      | ticket       | note            |
| Salesforce             | OAuth                            | contact/lead | case         | task            |
| Microsoft Dynamics 365 | OAuth                            | contact      | case         | task            |
| Zoho CRM               | OAuth                            | contact/lead | task         | note            |
| Pipedrive              | OAuth                            | person       | activity     | note            |
| Zendesk                | OAuth or API token               | user         | ticket       | ticket activity |
| Intercom               | OAuth or workspace token         | contact      | conversation | note            |
| Freshdesk              | OAuth or API key where supported | contact      | ticket       | ticket note     |

All provider requests use the outbound URL safety policy. Authentication failures mark a
connection for reauthentication; timeouts, rate limits, and server errors remain retryable.
Unsupported provider capabilities are successful no-ops.

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
