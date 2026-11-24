// SPDX-License-Identifier: AGPL-3.0-only
import type { UserId, WorkspaceId } from '../../db/ids';

export const SUGGESTION_CREATED = 'suggestion_created';
export const SUGGESTION_REVIEWED = 'suggestion_reviewed';

export interface SuggestionCreatedEvent {
  workspaceId: WorkspaceId;
  suggestionId: string;
  botId: string;
  conversationId: string | null;
  actorUserId: UserId;
}

export interface SuggestionReviewedEvent extends SuggestionCreatedEvent {
  creatorUserId: UserId | null;
  reviewerUserId: UserId;
  status: 'approved' | 'rejected';
}
