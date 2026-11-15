// SPDX-License-Identifier: AGPL-3.0-only
import type { ConversationStatus } from '@app/shared';

import { AppError } from '../../../common/errors';

/** The four state-changing agent actions of spec §17.7. */
export type ConversationAction = 'takeover' | 'agent_message' | 'handback' | 'close';

/**
 * The conversation state machine (spec §14.3). Every allowed edge is listed here, so an
 * impossible transition is one `invalid_transition` regardless of which route asked for it.
 */
export function nextStatus(
  current: ConversationStatus,
  action: ConversationAction,
): ConversationStatus {
  switch (action) {
    case 'takeover':
      if (current === 'ai' || current === 'needs_human') return 'human';
      break;
    case 'agent_message':
      // A human message takes over, and reopens a closed conversation as human-owned.
      return 'human';
    case 'handback':
      if (current === 'human' || current === 'needs_human') return 'ai';
      break;
    case 'close':
      return 'closed';
  }
  throw new AppError('invalid_transition', {
    message: `Cannot ${action.replaceAll('_', ' ')} a conversation that is ${current}.`,
  });
}
