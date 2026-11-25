// SPDX-License-Identifier: AGPL-3.0-only
import type { WorkspaceId, UserId } from '../../db/ids';
import type { TemplateData } from '../email';

interface BaseEvent {
  workspaceId: WorkspaceId;
  actorUserId: UserId | null;
}

export type NotificationEvent =
  | (BaseEvent & {
      type: 'handoff_requested';
      conversationId: string;
      botId: string;
      botName: string;
      reason: string | null;
      contactEmail: string | null;
      lastMessage: string | null;
      legacyRecipients: string[];
    })
  | (BaseEvent & {
      type: 'conversation_assigned';
      conversationId: string;
      botId: string;
      assigneeUserId: UserId;
      actorName: string;
    })
  | (BaseEvent & {
      type: 'visitor_replied';
      conversationId: string;
      botId: string;
      assigneeUserId: UserId;
      preview: string;
      hasInternalNotes: boolean;
    })
  | (BaseEvent & {
      type: 'spend_alert';
      botId: string;
      botName: string;
      month: string;
      threshold: 80 | 100;
      mtdUsd: string;
      capUsd: string;
      topContacts: TemplateData['spend_alert']['topContacts'];
      legacyRecipients: string[];
    })
  | (BaseEvent & {
      type: 'suggestion_created';
      suggestionId: string;
      botId: string;
      actorUserId: UserId;
    })
  | (BaseEvent & {
      type: 'suggestion_reviewed';
      suggestionId: string;
      botId: string;
      creatorUserId: UserId | null;
      actorUserId: UserId;
      status: 'approved' | 'rejected';
    });
