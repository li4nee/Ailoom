// SPDX-License-Identifier: MIT
import type {
  Citation,
  ConversationStatus,
  ErrorCode,
  NoAnswerBehavior,
  WidgetMessage,
} from '@app/shared';

/** The spec §18.2 visitor message stream, one variant per `event:` name. */
export type WidgetStreamEvent =
  | { type: 'message.accepted'; messageId: string; createdAt: string }
  | { type: 'answer.started'; messageId: string }
  | { type: 'answer.delta'; text: string }
  | { type: 'answer.completed'; messageId: string; content: string; citations: Citation[] }
  | {
      type: 'escalated';
      messageId: string;
      reason: string;
      behavior: NoAnswerBehavior;
      content: string;
    }
  | { type: 'handoff.offered'; messageId: string; reason: 'handoff_intent' }
  | { type: 'error'; code: ErrorCode; message: string };

/** The live events channel (spec §17.9): agent replies, status changes and resync. */
export type WidgetLiveEvent =
  | { type: 'message'; message: WidgetMessage }
  | { type: 'status'; status: ConversationStatus }
  | { type: 'resync' };

type Record_ = Record<string, unknown>;

function record(value: unknown): Record_ | null {
  return typeof value === 'object' && value !== null ? (value as Record_) : null;
}

function stringOf(value: Record_, key: string): string | null {
  const field = value[key];
  return typeof field === 'string' ? field : null;
}

/** Parses one `event:`/`data:` pair; an unknown or malformed frame is skipped. */
export function parseStreamEvent(name: string, raw: string): WidgetStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const body = record(data);
  if (body === null) return null;

  switch (name) {
    case 'message.accepted': {
      const messageId = stringOf(body, 'messageId');
      const createdAt = stringOf(body, 'createdAt');
      return messageId !== null && createdAt !== null
        ? { type: 'message.accepted', messageId, createdAt }
        : null;
    }
    case 'answer.started': {
      const messageId = stringOf(body, 'messageId');
      return messageId === null ? null : { type: 'answer.started', messageId };
    }
    case 'answer.delta': {
      const text = stringOf(body, 'text');
      return text === null ? null : { type: 'answer.delta', text };
    }
    case 'answer.completed': {
      const messageId = stringOf(body, 'messageId');
      const content = stringOf(body, 'content');
      if (messageId === null || content === null) return null;
      const citations = Array.isArray(body['citations']) ? (body['citations'] as Citation[]) : [];
      return { type: 'answer.completed', messageId, content, citations };
    }
    case 'escalated': {
      const messageId = stringOf(body, 'messageId');
      const reason = stringOf(body, 'reason');
      const content = stringOf(body, 'content');
      const behavior = stringOf(body, 'behavior');
      if (messageId === null || reason === null || content === null || behavior === null) {
        return null;
      }
      return {
        type: 'escalated',
        messageId,
        reason,
        behavior: behavior as NoAnswerBehavior,
        content,
      };
    }
    case 'handoff.offered': {
      const messageId = stringOf(body, 'messageId');
      return messageId === null
        ? null
        : { type: 'handoff.offered', messageId, reason: 'handoff_intent' };
    }
    case 'error': {
      const code = stringOf(body, 'code');
      const message = stringOf(body, 'message');
      return code === null || message === null
        ? null
        : { type: 'error', code: code as ErrorCode, message };
    }
    default:
      return null;
  }
}

/** Parses one live-channel frame; `message` frames carry a full `WidgetMessage`. */
export function parseLiveEvent(name: string, raw: string): WidgetLiveEvent | null {
  if (name === 'resync') return { type: 'resync' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const body = record(data);
  if (body === null) return null;
  if (name === 'message') return { type: 'message', message: body as never };
  if (name === 'status' && typeof body['status'] === 'string') {
    return { type: 'status', status: body['status'] as never };
  }
  return null;
}
