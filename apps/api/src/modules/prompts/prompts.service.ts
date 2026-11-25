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
  async getActive(
    workspaceId: WorkspaceId,
    botId: string,
    loadedBot?: Pick<BotEntity, 'activePromptVersionId'>,
  ): Promise<PromptVersionEntity | null> {
    const bot = loadedBot ?? (await this.botsService.get(workspaceId, botId));
    if (bot.activePromptVersionId === null) return null;
    return this.repository.findById(workspaceId, bot.activePromptVersionId);
  }

  /** A draft prompt may be selected by an evaluation, but only for its owning bot. */
  async getForEval(workspaceId: WorkspaceId, botId: string, promptVersionId: string) {
    await this.botsService.get(workspaceId, botId);
    const version = await this.repository.findById(workspaceId, promptVersionId);
    if (version?.botId !== botId) throw new AppError('not_found');
    return version;
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
      if (parsed.data.activate) {
        await this.activateInTransaction(workspaceId, botId, created.id, actor, 'admin', manager);
      }
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

  async activate(
    workspaceId: WorkspaceId,
    botId: string,
    versionId: string,
    actor: UserId,
    role: 'owner' | 'admin' | 'agent',
    overrideReason?: string,
  ) {
    return this.ds.transaction(async (manager) => {
      await this.activateInTransaction(
        workspaceId,
        botId,
        versionId,
        actor,
        role,
        manager,
        overrideReason,
      );
      return this.repository.findById(workspaceId, versionId, manager);
    });
  }

  private async activateInTransaction(
    workspaceId: WorkspaceId,
    botId: string,
    versionId: string,
    actor: UserId,
    role: 'owner' | 'admin' | 'agent',
    manager: import('typeorm').EntityManager,
    overrideReason?: string,
  ) {
    const bot = await this.botsService.get(workspaceId, botId);
    const version = await this.repository.findById(workspaceId, versionId, manager);
    if (version?.botId !== botId) throw new AppError('not_found');

    let failedGate: { message: string; runId?: string } | null = null;
    if (bot.evalGate !== null) {
      const rows = await manager.query<
        {
          id: string;
          summary: { passRate?: number } | null;
          baseline_summary: { passRate?: number } | null;
        }[]
      >(
        `SELECT r.id, r.summary, baseline.summary AS baseline_summary
           FROM eval_runs r
           LEFT JOIN eval_runs baseline ON baseline.id = r.baseline_run_id
          WHERE r.workspace_id = $1 AND r.bot_id = $2 AND r.dataset_id = $3
            AND r.status = 'completed' AND r.finished_at >= now() - interval '7 days'
            AND r.config->>'promptVersionId' = $4
          ORDER BY r.finished_at DESC, r.id DESC LIMIT 1`,
        [workspaceId, botId, bot.evalGate.datasetId, versionId],
      );
      const qualifying = rows[0];
      const passRate = qualifying?.summary?.passRate;
      const baselineRate = qualifying?.baseline_summary?.passRate;
      if (qualifying === undefined || passRate === undefined) {
        failedGate = {
          message: 'A completed evaluation for this prompt from the last 7 days is required.',
        };
      } else if (passRate < bot.evalGate.minPassRate) {
        failedGate = {
          runId: qualifying.id,
          message: `Pass rate ${passRate.toFixed(2)} is below ${bot.evalGate.minPassRate.toFixed(2)}.`,
        };
      } else if (
        baselineRate !== undefined &&
        baselineRate - passRate > bot.evalGate.maxRegression
      ) {
        failedGate = {
          runId: qualifying.id,
          message: `Pass rate regression ${(baselineRate - passRate).toFixed(2)} exceeds ${bot.evalGate.maxRegression.toFixed(2)}.`,
        };
      }
    }

    if (failedGate !== null) {
      if (overrideReason === undefined) {
        throw new AppError('conflict', {
          details: [
            {
              path: 'evalGate',
              message:
                failedGate.runId === undefined
                  ? failedGate.message
                  : `${failedGate.message} Run ${failedGate.runId}.`,
            },
          ],
        });
      }
      if (role !== 'owner') throw new AppError('forbidden');
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'eval.gate_overridden',
          targetType: 'prompt_version',
          targetId: versionId,
          metadata: { botId, reason: overrideReason, runId: failedGate.runId ?? null },
        },
        manager,
      );
    }

    await this.bots.updateById(workspaceId, botId, { activePromptVersionId: versionId }, manager);
    await this.audit.record(
      {
        workspaceId,
        actorUserId: actor,
        action: 'bot.prompt_updated',
        targetType: 'bot',
        targetId: botId,
        metadata: { versionId, overrideReason: overrideReason ?? null },
      },
      manager,
    );
  }
}
