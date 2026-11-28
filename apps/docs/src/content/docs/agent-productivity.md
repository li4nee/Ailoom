---
title: Agent productivity
description: Agent presence, automatic handoff routing, service targets, customer context, and reviewed AI assistance.
---

# Agent productivity

The workspace inbox lets agents find and handle conversations with explicit routing controls.
Owners and admins can manage workspace saved replies and configure AI assistance for each bot.
Agents can assign eligible conversations, set priority, add workspace-visible notes, and prepare
customer replies. Changes use version checks and are shared with other open inboxes.

## Assignments and priorities

Use the inbox filters to narrow by status, assignee, priority, bot, or message text. The inbox puts
handoffs first, then urgent and high-priority conversations, then the most recently active item.
Open a conversation to assign it to a workspace member or release it back to the unassigned queue.
Owners and admins can route conversations to workspace members. Agents can assign or release work
they are permitted to handle. A stale concurrent update returns a conflict; reload the conversation
and choose again. Assignment and priority changes are audited and invalidate other workspace inboxes.

## Availability, automatic routing, and service targets

Agents set their own presence to **Online**, **Away**, or **Offline** under **Settings → Agent
operations**. Online and away presence expires after five minutes unless the open admin session
refreshes its lease. Only online members are eligible for automatic assignment. Owners and admins
can see the workspace roster but cannot change another member's presence.

Owners and admins can enable workspace handoff routing and choose round-robin or least-loaded
selection, with a maximum number of open assigned conversations per agent. A handoff stays
unassigned when no online member is below capacity. Existing conversations are not reassigned when
the setting changes, and manual assignment remains available.

Service targets are configured separately for first response and resolution at each priority.
The current priority and targets are captured when a new conversation is handed to a person; the
response clock stops at the first agent
reply, and the resolution clock stops when the conversation closes. Business hours use the configured
IANA timezone and repeat weekly. Leave every day empty for a 24/7 schedule. Breaches are checked by
the background worker about once a minute, appear on the conversation, and notify workspace owners
and admins. The system does not apply holiday calendars, pause rules, escalation tiers, or automatic
reassignment.

## Customer context

The sidebar shows the contact's email and external ID, first and last seen times, bounded attributes,
recent conversation history, and linked CRM contact records. Sensitive-looking attributes are
masked until an agent chooses to reveal them. Treat contact attributes and CRM data as customer
data: they remain workspace-scoped and are not copied into public conversation messages by the
sidebar.

## Saved replies and internal notes

Owners and admins create, edit, reorder, archive, and search saved replies in workspace settings.
Agents can insert a saved reply into the composer and edit it before sending. Inserting never sends
it.

Internal notes are visible to everyone in the workspace and never to the customer. Notes are stored
separately from messages, do not change conversation activity or trigger visitor delivery, and are
excluded from email, webhooks, CRM transcript sharing, search, and default AI context. Authors can
edit or delete their notes; owners and admins can moderate all notes. Deletion clears the note text
and leaves a tombstone for the timeline.

## AI summaries and suggested replies

AI assistance is off for existing bots until an owner or admin enables it. The bot settings have a
master kill switch and separate controls for asynchronous handoff summaries and agent-requested
suggested replies. Suggestions use retrieved workspace knowledge and bounded public conversation
context. They show citations and the message through which they were generated; a new message marks
the draft stale. If the sources do not support an answer, the system returns an insufficient-context
state. Provider errors, disabled modes, rate limits, and spend caps can prevent generation.

AI output is a draft. An agent must inspect it, insert it into the composer, and use the ordinary
**Send reply** action. AiLoom never sends a summary or suggested reply automatically. The run is
recorded in the workspace trace and usage records with provider/model, prompt version, retrieval,
token use, cost, and latency. Workspace admins can see a rolling 24-hour operations summary at
`GET /api/v1/workspaces/{workspaceId}/agent-assist/operations`; it contains aggregates and safe
configuration status, not prompts, drafts, or customer identifiers. Use the existing credential
test action to verify current provider reachability. AiLoom does not export telemetry or phone home.

Before changing a supported model or prompt, run the [agent-assist release evaluation](/agent-assist-evaluation/)
against the 25 versioned safety scenarios. The live-provider workflow is manual and must not run in
ordinary CI.

## Correcting AI answers

Workspace members can mark a completed AI answer correct or submit a correction from its
conversation. The correction includes the visitor question and a replacement answer; the agent can
edit both before submitting. It remains a workspace-only suggestion. Owners and admins review
suggestions under **Knowledge → Suggestions**, where they can edit the text before approval or
reject it with a reason. Approval creates a normal text knowledge source for that bot, formatted as
`Question: …` followed by `Answer: …`; the existing indexing pipeline makes it available for
retrieval. Corrections and review details are not sent to visitors or included in CRM or webhook
transcripts.

## Notifications

The bell in the workspace header lists handoffs, assignments, visitor replies to assigned work,
SLA breaches, spend alerts, and knowledge-correction updates. Select an item to open the related conversation,
suggestion queue, or usage page; use **Mark all read** to clear the unread count. New notifications
arrive over the workspace's live event stream, and each member sees only their own items.

Choose **Notification preferences** in workspace settings to control in-app and email delivery for
each notification type. Defaults depend on your workspace role and can be changed independently per
workspace. Handoff emails may also go to addresses configured by the workspace owner. Visitor reply
previews are omitted when the conversation contains internal notes.
