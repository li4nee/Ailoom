// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { ZodError } from 'zod';

import type {
  ActivatePromptVersionRequest,
  CreatePromptVersionRequest,
  PromptReleaseStatus,
} from '@app/shared';
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
 * Spec §9.2: each saved prompt is immutable. Activation changes the bot’s active pointer.
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
        return this.activateInTransaction(workspaceId, botId, created.id, actor, 'admin', manager);
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.prompt_updated',
          targetType: 'bot',
          targetId: botId,
          metadata: { version, versionId: created.id, operation: 'save' },
        },
        manager,
      );
      return created;
    });
  }

  async releaseStatus(workspaceId: WorkspaceId, botId: string, versionId: string) {
    const bot = await this.botsService.get(workspaceId, botId);
    const version = await this.repository.findById(workspaceId, versionId);
    if (version?.botId !== botId) throw new AppError('not_found');
    return this.releaseStatusFor(bot, version, this.ds.manager);
  }

  async activate(
    workspaceId: WorkspaceId,
    botId: string,
    versionId: string,
    actor: UserId,
    role: 'owner' | 'admin' | 'agent',
    input: ActivatePromptVersionRequest,
  ) {
    return this.ds.transaction(async (manager) => {
      await this.repository.lockBot(workspaceId, botId, manager);
      return this.activateInTransaction(workspaceId, botId, versionId, actor, role, manager, input);
    });
  }

  private async activateInTransaction(
    workspaceId: WorkspaceId,
    botId: string,
    versionId: string,
    actor: UserId,
    role: 'owner' | 'admin' | 'agent',
    manager: EntityManager,
    input: ActivatePromptVersionRequest = {},
  ) {
    const bot = await this.bots.getById(workspaceId, botId, 'not_found', manager);
    const version = await this.repository.findById(workspaceId, versionId, manager);
    if (version?.botId !== botId) throw new AppError('not_found');
    if (role === 'agent') throw new AppError('forbidden');
    if (bot.activePromptVersionId === versionId) return version;
    if (
      input.expectedActiveVersionId !== undefined &&
      input.expectedActiveVersionId !== bot.activePromptVersionId
    ) {
      throw new AppError('conflict', {
        details: [
          {
            path: 'activeVersionId',
            message: 'The live prompt changed. Review the updated version before continuing.',
          },
        ],
      });
    }

    const { operation, gate } = await this.releaseStatusFor(bot, version, manager);
    if (gate !== null && gate.blockedReason !== null) {
      if (input.overrideReason === undefined) {
        throw new AppError('conflict', {
          details: [{ path: 'evalGate', message: gate.blockedReason }],
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
          metadata: { botId, reason: input.overrideReason, runId: gate.runId },
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
        metadata: {
          operation,
          versionId,
          previousVersionId: bot.activePromptVersionId,
          runId: gate?.runId ?? null,
          overrideReason: gate?.blockedReason ? (input.overrideReason ?? null) : null,
        },
      },
      manager,
    );
    return version;
  }

  private async releaseStatusFor(
    bot: BotEntity,
    version: PromptVersionEntity,
    manager: EntityManager,
  ): Promise<PromptReleaseStatus> {
    const active =
      bot.activePromptVersionId === null
        ? null
        : await this.repository.findById(bot.workspaceId, bot.activePromptVersionId, manager);
    const operation = active !== null && version.version < active.version ? 'rollback' : 'publish';
    const status: PromptReleaseStatus = {
      activeVersionId: bot.activePromptVersionId,
      operation,
      gate: null,
    };
    const gate = bot.evalGate;
    if (gate === null) return status;

    const rows = await manager.query<
      {
        id: string;
        summary: { passRate: number } | null;
        baseline_summary: { passRate: number } | null;
      }[]
    >(
      `SELECT r.id, r.summary, baseline.summary AS baseline_summary
         FROM eval_runs r
         LEFT JOIN eval_runs baseline ON baseline.id = r.baseline_run_id
          AND baseline.workspace_id = r.workspace_id AND baseline.bot_id = r.bot_id
          AND baseline.dataset_id = r.dataset_id
        WHERE r.workspace_id = $1 AND r.bot_id = $2 AND r.dataset_id = $3
          AND r.status = 'completed' AND r.finished_at >= now() - interval '7 days'
          AND r.config->>'promptVersionId' = $4
          AND COALESCE((r.config->>'comparisonOnly')::boolean, false) = false
          AND COALESCE(r.config->>'retrievalMode', 'vector') = $5
          AND COALESCE((r.summary->>'inconclusive')::boolean, false) = false
        ORDER BY r.finished_at DESC, r.id DESC LIMIT 1`,
      [bot.workspaceId, bot.id, gate.datasetId, version.id, bot.retrievalMode],
    );
    const run = rows[0];
    const passRate = run?.summary?.passRate ?? null;
    const baselinePassRate = run?.baseline_summary?.passRate ?? null;
    let blockedReason: string | null = null;
    if (passRate === null) {
      blockedReason =
        'Complete an evaluation for this version on the required dataset within the last seven days.';
    } else if (passRate < gate.minPassRate) {
      blockedReason = `Pass rate ${percent(passRate)} is below the required ${percent(gate.minPassRate)}.`;
    } else if (baselinePassRate !== null && baselinePassRate - passRate > gate.maxRegression) {
      blockedReason = `Pass rate dropped by ${((baselinePassRate - passRate) * 100).toFixed(1)} percentage points. The limit is ${(gate.maxRegression * 100).toFixed(1)}.`;
    }
    status.gate = {
      datasetId: gate.datasetId,
      runId: run?.id ?? null,
      passRate,
      baselinePassRate,
      blockedReason,
    };
    return status;
  }
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
