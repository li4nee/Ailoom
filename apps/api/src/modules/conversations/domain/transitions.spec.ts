// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { ConversationStatus } from '@app/shared';

import { AppError } from '../../../common/errors';
import { nextStatus, type ConversationAction } from './transitions';

function errorOf(fn: () => void): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe('nextStatus', () => {
  it.each<[ConversationStatus, ConversationAction, ConversationStatus]>([
    ['ai', 'takeover', 'human'],
    ['needs_human', 'takeover', 'human'],
    ['needs_human', 'agent_message', 'human'],
    ['human', 'agent_message', 'human'],
    ['closed', 'agent_message', 'human'],
    ['human', 'handback', 'ai'],
    ['needs_human', 'handback', 'ai'],
    ['ai', 'close', 'closed'],
    ['needs_human', 'close', 'closed'],
    ['human', 'close', 'closed'],
    ['closed', 'close', 'closed'],
  ])('%s + %s → %s', (current, action, expected) => {
    expect(nextStatus(current, action)).toBe(expected);
  });

  it.each<[ConversationStatus, ConversationAction]>([
    ['human', 'takeover'],
    ['closed', 'takeover'],
    ['ai', 'handback'],
    ['closed', 'handback'],
  ])('%s + %s is rejected', (current, action) => {
    expect(() => nextStatus(current, action)).toThrow(AppError);
    expect(errorOf(() => nextStatus(current, action))).toMatchObject({
      code: 'invalid_transition',
      status: 409,
    });
  });
});
