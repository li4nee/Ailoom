// SPDX-License-Identifier: AGPL-3.0-only
import type { WorkspaceId } from '../db/ids';

/**
 * Emitted after the transaction that set `needs_human` commits, so a listener never reacts to
 * a handoff that rolled back. Consumed by the inbox/notification work in Milestone 6.
 */
export const CHAT_HANDOFF_REQUESTED = 'chat.handoff_requested';

export interface ChatHandoffRequestedEvent {
  workspaceId: WorkspaceId;
  botId: string;
  conversationId: string;
}
