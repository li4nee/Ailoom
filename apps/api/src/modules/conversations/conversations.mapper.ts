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

export function toConversationDetail(row: InboxRow, messages: AdminMessage[]): ConversationDetail {
  return {
    conversation: toAdminConversation(row),
    contact: contactOf(row),
    messages,
  };
}
