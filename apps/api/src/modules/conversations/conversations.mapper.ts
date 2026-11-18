// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AdminConversation,
  AdminMessage,
  Citation,
  ConversationDetail,
  ConversationListItem,
} from '@app/shared';

import type { MessageEntity } from './entities/message.entity';
import type { InboxRow } from './inbox.repository';

function iso(value: Date): string {
  return value.toISOString();
}

function contactOf(row: InboxRow): ConversationListItem['contact'] {
  return {
    id: row.contact_id,
    email: row.contact_email,
    name: row.contact_name,
  };
}

function assigneeOf(row: InboxRow): ConversationListItem['assignedTo'] {
  if (row.assigned_user_id === null || row.assigned_name === null) return null;
  return { id: row.assigned_user_id, name: row.assigned_name };
}

export function toConversationListItem(row: InboxRow): ConversationListItem {
  return {
    id: row.id,
    botId: row.bot_id,
    botName: row.bot_name,
    status: row.status,
    workflowVersion: row.workflow_version,
    priority: row.priority,
    contact: contactOf(row),
    assignedTo: assigneeOf(row),
    handoffReason: row.handoff_reason,
    handoffRequestedAt: row.handoff_requested_at === null ? null : iso(row.handoff_requested_at),
    lastMessageAt: iso(row.last_message_at),
    lastMessagePreview: row.last_message_preview ?? '',
    unansweredByHuman: row.unanswered_by_human,
  };
}

export function toAdminConversation(row: InboxRow): AdminConversation {
  return {
    id: row.id,
    botId: row.bot_id,
    botName: row.bot_name,
    channel: row.channel,
    status: row.status,
    workflowVersion: row.workflow_version,
    assignedTo: assigneeOf(row),
    handoffReason: row.handoff_reason,
    handoffRequestedAt: row.handoff_requested_at === null ? null : iso(row.handoff_requested_at),
    priority: row.priority,
    lastMessageAt: iso(row.last_message_at),
    closedAt: row.closed_at === null ? null : iso(row.closed_at),
    metadata: row.metadata,
    createdAt: iso(row.created_at),
  };
}

function citationsOf(message: MessageEntity): Citation[] | null {
  if (message.citations === null) return null;
  return message.citations.map((citation) => ({
    n: citation.n,
    chunkId: citation.chunk_id,
    documentId: citation.document_id,
    title: citation.title ?? 'Source',
    url: citation.url,
  }));
}

export function toAdminMessage(
  message: MessageEntity,
  traceId: string | null,
  authorName: string | null,
): AdminMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: citationsOf(message),
    status: message.status,
    feedback: message.feedback === 1 || message.feedback === -1 ? message.feedback : null,
    author:
      message.authorUserId === null
        ? null
        : { id: message.authorUserId, name: authorName ?? 'Deleted user' },
    traceId,
    createdAt: iso(message.createdAt),
  };
}

function boundedAttribute(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 500);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value))
    return value.slice(0, 10).map((item) => boundedAttribute(item, depth + 1));
  if (typeof value !== 'object') return '[Unsupported value]';
  if (depth >= 2) return '[Object]';
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, child]) => [key.slice(0, 80), boundedAttribute(child, depth + 1)]),
  );
}

export function toConversationDetail(
  row: InboxRow,
  messages: AdminMessage[],
  contactHistory: InboxRow[],
  crmLinks: ConversationDetail['crmLinks'],
  handoffSummaryEnabled: boolean,
  handoffSummary: ConversationDetail['handoffSummary'],
  suggestedRepliesEnabled: boolean,
  suggestedReply: ConversationDetail['suggestedReply'],
): ConversationDetail {
  return {
    conversation: toAdminConversation(row),
    contact: {
      ...contactOf(row),
      externalId: row.contact_external_id,
      attributes: Object.fromEntries(
        Object.entries(row.contact_attributes ?? {})
          .slice(0, 30)
          .map(([key, value]) => [key.slice(0, 80), boundedAttribute(value)]),
      ),
      firstSeenAt: iso(row.contact_first_seen_at),
      lastSeenAt: iso(row.contact_last_seen_at),
    },
    crmLinks,
    contactHistory: contactHistory.map((item) => ({
      id: item.id,
      botName: item.bot_name,
      status: item.status,
      assignedTo: assigneeOf(item),
      priority: item.priority,
      lastMessageAt: iso(item.last_message_at),
      lastMessagePreview: item.last_message_preview ?? '',
    })),
    messages,
    handoffSummaryEnabled,
    handoffSummary,
    suggestedRepliesEnabled,
    suggestedReply,
  };
}
