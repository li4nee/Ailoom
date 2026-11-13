// SPDX-License-Identifier: MIT
import type { ConversationStatus, MessageRole, SourceStatus } from './enums.js';

/**
 * A source status only ever sent over the realtime channel: a deleted source is gone from the
 * table, so `deleted` is not a value of the Postgres `source_status` enum (spec §12.8).
 */
export const DELETED_SOURCE_STATUS = 'deleted' as const;
export type SourceEventStatus = SourceStatus | typeof DELETED_SOURCE_STATUS;

/**
 * One notification on a workspace channel (spec §18.3). Payloads stay small on purpose: the
 * client refetches the resource it names instead of trusting the event as data.
 */
export type RealtimeEvent =
  | { type: 'source.updated'; sourceId: string; botId: string; status: SourceEventStatus }
  | {
      type: 'conversation.created';
      conversationId: string;
      botId: string;
      status: ConversationStatus;
    }
  | {
      type: 'conversation.updated';
      conversationId: string;
      botId: string;
      status: ConversationStatus;
    }
  | { type: 'message.created'; conversationId: string; messageId: string; role: MessageRole }
  /**
   * Sent to every subscriber after the LISTEN connection reconnected: events may have been
   * missed, so clients refetch what they show.
   */
  | { type: 'resync' };

/** Every event type, for clients that subscribe to each SSE event name. */
export const REALTIME_EVENT_TYPES = [
  'source.updated',
  'conversation.created',
  'conversation.updated',
  'message.created',
  'resync',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];
