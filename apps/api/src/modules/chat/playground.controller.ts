// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';
import { z } from 'zod';

import { AppError } from '../../common/errors';
import { asBotId, asWorkspaceId } from '../../db/ids';
import { RequireRole } from '../auth';
import { BotsService } from '../bots';
import { openSse } from '../realtime';
import { ChatOrchestrator } from './chat-orchestrator';
import { SseAnswerSink } from './sse-answer-sink';

const playgroundRequestSchema = z.object({
  history: z
    .array(
      z.object({
        role: z.enum(['visitor', 'ai']),
        content: z.string().max(2_000),
      }),
    )
    .max(20)
    .default([]),
  content: z.string().trim().min(1).max(2_000),
});

export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>;

/**
 * Spec §17.5: an admin tests the bot without creating a conversation. Answers stream over SSE
 * with the same events as the widget, plus a final `trace` (origin `playground`).
 */
@Controller('v1/workspaces/:workspaceId/bots/:botId/playground')
export class PlaygroundController {
  constructor(
    private readonly bots: BotsService,
    private readonly orchestrator: ChatOrchestrator,
  ) {}

  @Post()
  @RequireRole('admin')
  async run(
    @Param('workspaceId') workspaceId: string,
    @Param('botId') botId: string,
    @Body() body: unknown,
    @Res() reply: NodeResponse,
  ): Promise<void> {
    // Membership and the live bot are resolved before validation, so a non-member sees 404
    // rather than a validation error that would confirm the workspace exists.
    const ws = asWorkspaceId(workspaceId);
    const id = asBotId(botId);
    await this.bots.get(ws, id);

    const parsed = playgroundRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }

    const sse = openSse(reply);
    const controller = new AbortController();
    sse.onClose(() => {
      controller.abort();
    });

    const sink = new SseAnswerSink(sse, { includeTrace: true });
    try {
      await this.orchestrator.handle(
        {
          workspaceId: ws,
          botId: id,
          mode: {
            kind: 'playground',
            history: parsed.data.history,
            content: parsed.data.content,
          },
          signal: controller.signal,
        },
        sink,
      );
    } finally {
      sse.close();
    }
  }
}
