// SPDX-License-Identifier: AGPL-3.0-only
import type { WidgetConversation, WidgetMessage } from '@app/shared';

import type { ConversationEntity, MessageEntity } from '../conversations';

/** The widget never sees internal ids it does not already hold, nor author or review fields. */
export function toWidgetMessage(message: MessageEntity): WidgetMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations:
      message.citations === null
        ? null
        : message.citations.map((citation) => ({
            n: citation.n,
            chunkId: citation.chunk_id,
            documentId: citation.document_id,
            title: citation.title ?? 'Source',
            url: citation.url,
          })),
    status: message.status,
    feedback: message.feedback === 1 || message.feedback === -1 ? message.feedback : null,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toWidgetConversation(
  conversation: ConversationEntity,
  messages: MessageEntity[],
): WidgetConversation {
  return {
    id: conversation.id,
    status: conversation.status,
    messages: messages.map(toWidgetMessage),
  };
}
