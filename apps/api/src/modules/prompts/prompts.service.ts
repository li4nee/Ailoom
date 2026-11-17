// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ZodError } from 'zod';

import type { CreatePromptVersionRequest } from '@app/shared';
import { createPromptVersionSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { BotsRepository, BotsService, type BotEntity, type PromptVersionEntity } from '../bots';
import { PromptVersionsRepository } from './prompt-versions.repository';

function validationError(error: ZodError): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/**
 * Spec §9.2: every save of a bot's instructions appends a version and points the bot at it.
 * Versions are never edited or deleted, so an answer can always be traced to the prompt that
 * produced it.
 */
@Injectable()
export class PromptsService {
  constructor(
    private readonly ds: DataSource,
    private readonly bots: BotsRepository,
    private readonly botsService: BotsService,
    private readonly repository: PromptVersionsRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async list(workspaceId: WorkspaceId, botId: string): Promise<PromptVersionEntity[]> {
    // Through the service, so a soft-deleted bot is a 404 here as it is on every bot route.
    await this.botsService.get(workspaceId, botId);
    return this.repository.listForBot(workspaceId, botId);
  }

  /** The version the bot currently answers with, or null for a bot that has none yet. */
  async getActive(workspaceId: WorkspaceId, botId: string): Promise<PromptVersionEntity | null> {
    const bot = await this.botsService.get(workspaceId, botId);
    return this.getActiveForBot(workspaceId, bot);
  }

  /** Reads the active version when the caller already loaded and authorized the bot. */
  async getActiveForBot(
    workspaceId: WorkspaceId,
    bot: Pick<BotEntity, 'activePromptVersionId'>,
  ): Promise<PromptVersionEntity | null> {
    if (bot.activePromptVersionId === null) return null;
    return this.repository.findById(workspaceId, bot.activePromptVersionId);
  }

  async create(
    workspaceId: WorkspaceId,
    botId: string,
    input: CreatePromptVersionRequest,
    actor: UserId,
  ): Promise<PromptVersionEntity> {
    const parsed = createPromptVersionSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);

    return this.ds.transaction(async (manager) => {
      // Lock first: the version number is `max + 1`, which two concurrent saves would share.
      await this.repository.lockBot(workspaceId, botId, manager);
      const version = await this.repository.nextVersion(workspaceId, botId, manager);
      const created = await this.repository.insert(
        workspaceId,
        {
          botId,
          version,
          systemPrompt: parsed.data.systemPrompt,
          note: parsed.data.note ?? null,
          createdBy: actor,
        },
        manager,
      );
      await this.bots.updateById(
        workspaceId,
        botId,
        { activePromptVersionId: created.id },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.prompt_updated',
          targetType: 'bot',
          targetId: botId,
          metadata: { version },
        },
        manager,
      );
      return created;
    });
  }
}
