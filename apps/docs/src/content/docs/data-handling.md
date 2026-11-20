---
title: Data handling
description: What an AiLoom instance stores, sends to providers, and retains
---

# Data handling

AiLoom is self-hosted. The instance operator controls the server, database, uploaded-file
storage, backups, logs, email transport, and which model and integration providers are
configured. AiLoom does not send telemetry or phone home. Operators should tell their own
customers what data the instance collects and which providers receive it.

## What the instance stores

PostgreSQL stores account and workspace records, contacts and their configured identity
attributes, conversation messages and workflow state, bot instructions, knowledge-source
metadata and indexed content, generation traces and usage, audit records, and integration
state. Uploaded source files are stored in the configured file volume (`/data/files` in the
Compose deployment). Provider and integration credentials are encrypted using
`ENCRYPTION_KEYS`; losing those keys can make saved credentials unrecoverable.

Generation traces can include the prompt version, bot instructions, retrieved content and
scores, provider and model names, token counts, cost, latency, and outcome. Admins can inspect
answer details in the trace view. Treat database access and trace access as access to customer
conversation data.

## Where data is sent

- **Chat and embedding providers:** A chat request can include the bot instructions, relevant
  knowledge, recent conversation history, and the visitor's latest message. Embedding requests
  include the text being indexed or searched. These are sent to the provider configured for
  that bot. Built-in local embeddings run inside the AiLoom deployment; Ollama sends requests
  to the configured Ollama host. Check each provider's data-processing terms and retention
  settings before connecting it.
- **Email provider:** When email is enabled, the configured SMTP or Resend service processes
  the recipient and the email content AiLoom sends, such as account messages and configured
  handoff or reply notifications. `EMAIL_TRANSPORT=none` logs email content locally instead
  of delivering it; do not use that mode on a public instance.
- **CRM and webhooks:** Integrations send their configured contact fields and event payloads.
  Transcript sharing is off by default and must be explicitly enabled for a CRM connection.
  Review [Integrations](/integrations/) before connecting a destination.
- **Website widget:** The widget sends chat messages and the configured visitor identity
  fields to the AiLoom instance. Only send identity fields your website has verified. See
  [Widget identity](/widget/#identifying-visitors).

AiLoom does not control how external providers retain or use data after receiving it. Review
their current settings and terms directly.

## Retention and deletion

The cleanup worker runs once daily at 03:00 UTC. Current defaults are:

| Data                       | Default                                              | Behavior                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conversations and messages | Keep indefinitely (`RETENTION_CONVERSATIONS_DAYS=0`) | When enabled, hard-deletes conversations with no message within the configured number of days if they are closed or still AI-owned. Conversations assigned to a person or waiting for a person are retained. |
| Generation traces          | 90 days                                              | Hard-deletes older traces. Set to `0` to disable cleanup.                                                                                                                                                    |
| Revoked sessions           | 90 days                                              | Hard-deletes old revoked session records. Set to `0` to disable cleanup.                                                                                                                                     |

Conversation retention uses the time of the last message, not the creation date. Retention
deletes primary database records; it does not erase copies already included in backups or
copies delivered to an email, CRM, or webhook provider.

Deleting a workspace queues a background purge of that workspace's database records and
uploaded files. Keep the worker running and check its logs to confirm the purge completed.
Existing backups remain until the operator's backup lifecycle removes them. Deleting a user
account is not a contact-data export or erasure workflow. This release has no general
contact-level export/erasure tool; operators must review applicable requests across the
database, uploaded files, backups, logs, and connected services.

## Backups, keys, and access

Backups contain the PostgreSQL database and uploaded files, so they can contain conversations,
contacts, traces, and encrypted provider credentials. Store backups off-host, restrict access,
encrypt them, and set a deletion schedule. Keep the matching `ENCRYPTION_KEYS` securely
available for restore, separately from the backup archive. See [Backups and restore](/backups/).

Use a production email service, restrict signup as appropriate, protect the host and database,
and limit admin access to people who need to handle conversation data. See [Security](/security/)
and [Configuration](/configuration/) for the relevant controls.
