// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { ApiError, errorFromResponse } from '@/lib/api-error';
import {
  readSse,
  type Citation,
  type ErrorCode,
  type NoAnswerBehavior,
  type SseEvent,
  type TraceDecision,
} from '@app/shared';

const messageIdSchema = z.object({ messageId: z.string() });
const citationSchema = z.object({
  n: z.number(),
  chunkId: z.string(),
  documentId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

const eventSchemas = {
  'message.accepted': messageIdSchema.extend({ createdAt: z.string() }),
  'answer.started': messageIdSchema,
  'answer.delta': z.object({ text: z.string() }),
  'answer.completed': messageIdSchema.extend({
    content: z.string(),
    citations: z.array(citationSchema),
  }),
  escalated: messageIdSchema.extend({
    reason: z.string(),
    behavior: z.string(),
    content: z.string(),
  }),
  'handoff.offered': messageIdSchema.extend({ reason: z.string() }),
  error: z.object({ code: z.string(), message: z.string() }),
  trace: z.object({
    traceId: z.string(),
    decision: z.string(),
    topScore: z.number().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.string(),
    latencyMs: z.number(),
  }),
} as const;

type EventName = keyof typeof eventSchemas;

export interface PlaygroundTrace {
  traceId: string;
  decision: TraceDecision;
  topScore: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number;
}

export interface PlaygroundEscalation {
  reason: string;
  behavior: NoAnswerBehavior;
  content: string;
}

export interface PlaygroundCompletion {
  messageId: string;
  content: string;
  citations: Citation[];
}

/** Events the playground UI reacts to; the wire type stays close to the API contract. */
export type PlaygroundEvent =
  | { event: 'answer.delta'; data: { text: string } }
  | { event: 'answer.completed'; data: PlaygroundCompletion }
  | { event: 'escalated'; data: PlaygroundEscalation }
  | { event: 'handoff.offered'; data: { messageId: string; reason: string } }
  | { event: 'error'; data: { code: ErrorCode; message: string } }
  | { event: 'trace'; data: PlaygroundTrace };

function parse(raw: SseEvent): PlaygroundEvent | null {
  if (!(raw.event in eventSchemas)) return null;
  const name = raw.event as EventName;
  let body: unknown;
  try {
    body = JSON.parse(raw.data) as unknown;
  } catch {
    return null;
  }
  const parsed = eventSchemas[name].safeParse(body);
  if (!parsed.success) return null;
  if (name === 'message.accepted' || name === 'answer.started') return null;
  return { event: name, data: parsed.data } as PlaygroundEvent;
}

/**
 * Streams one playground answer. `EventSource` only supports GET, so this uses `fetch()` with
 * the shared SSE reader; the server queues deltas, so text arrives progressively.
 */
export async function* streamPlayground(input: {
  workspaceId: string;
  botId: string;
  content: string;
  history: { role: 'visitor' | 'ai'; content: string }[];
  signal?: AbortSignal;
}): AsyncGenerator<PlaygroundEvent> {
  const response = await fetch(
    `/api/v1/workspaces/${input.workspaceId}/bots/${input.botId}/playground`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: JSON.stringify({ content: input.content, history: input.history }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );

  if (!response.ok) throw await errorFromResponse(response);
  if (response.body === null) {
    throw new ApiError({
      code: 'internal_error',
      status: response.status,
      message: 'The answer stream was empty',
      requestId: response.headers.get('X-Request-Id') ?? '',
    });
  }

  for await (const raw of readSse(response.body, input.signal)) {
    const event = parse(raw);
    if (event !== null) yield event;
  }
}
