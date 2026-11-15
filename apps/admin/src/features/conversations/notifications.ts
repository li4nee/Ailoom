// SPDX-License-Identifier: AGPL-3.0-only
import type { NeedsHumanNotification } from '@/lib/notifications';
import { strings } from '@/strings';
import type { ConversationDetail } from '@app/shared';

const PREVIEW_MAX = 140;

function lastVisitorMessage(detail: ConversationDetail): string | null {
  for (let index = detail.messages.length - 1; index >= 0; index -= 1) {
    const message = detail.messages[index];
    if (message?.role !== 'visitor') continue;
    const text = message.content.replace(/\s+/g, ' ').trim();
    if (text !== '') return text.slice(0, PREVIEW_MAX);
  }
  return null;
}

/** Notification content from the conversation itself, rather than a placeholder bot name. */
export function needsHumanNotification(
  detail: ConversationDetail,
  workspaceId: string,
): NeedsHumanNotification {
  return {
    workspaceId,
    conversationId: detail.conversation.id,
    botName: detail.conversation.botName,
    preview: lastVisitorMessage(detail) ?? strings.conversations.notificationFallback,
  };
}
