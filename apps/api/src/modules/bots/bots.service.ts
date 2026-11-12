// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ZodError } from 'zod';

import type { CreateBotRequest, ProviderKind, UpdateBotRequest } from '@app/shared';
import { createBotSchema, updateBotSchema } from '@app/shared';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { newPublicKey } from '../../common/ids';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { JobsService } from '../../jobs';
import { ModelCatalog, supportsChat, supportsEmbeddings } from '../../providers';
import { CredentialsService, type ProviderCredentialEntity } from '../credentials';
import { PURGE_BOT_KNOWLEDGE_JOB } from '../knowledge/knowledge.jobs';
import type { BotEntity } from './bot.entity';
import { BotsRepository } from './bots.repository';
import { BOT_DEFAULTS } from './domain/bot-defaults';
import { normalizeOriginPattern } from './domain/origin-matcher';

interface EmbeddingSelection {
  embeddingCredentialId: string;
  embeddingModel: string;
}

function validationError(error: ZodError): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

/** Money is `numeric(10,2)`; the API takes a number but never stores it as a float. */
function usd(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/**
 * Spec §17.5. A bot owns the model selection, retrieval and widget settings; its chat and
 * embedding credentials must live in the same workspace and actually support that use.
 */
@Injectable()
export class BotsService {
  constructor(
    private readonly ds: DataSource,
    private readonly repository: BotsRepository,
    private readonly credentials: CredentialsService,
    private readonly jobs: JobsService,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    workspaceId: WorkspaceId,
    input: CreateBotRequest,
    actor: UserId,
  ): Promise<BotEntity> {
    const parsed = createBotSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;

    await this.credential(workspaceId, body.chatCredentialId, 'chat');
    const selection = await this.resolveEmbedding(workspaceId, body);
    const embedding = await this.credentials.get(workspaceId, selection.embeddingCredentialId);
    const info = ModelCatalog.embedding(embedding.provider, selection.embeddingModel);
    const dim = this.embeddingDim(embedding.provider, selection.embeddingModel);
    const threshold = body.retrievalThreshold ?? info?.threshold ?? ModelCatalog.defaultThreshold;

    const appearance = {
      ...BOT_DEFAULTS.appearance,
      ...body.appearance,
    };

    return this.ds.transaction(async (manager) => {
      const created = await this.repository.insert(
        workspaceId,
        {
          name: body.name,
          publicKey: newPublicKey(),
          allowedOrigins: (body.allowedOrigins ?? BOT_DEFAULTS.allowedOrigins).map(
            normalizeOriginPattern,
          ),
          chatCredentialId: body.chatCredentialId,
          chatModel: body.chatModel,
          embeddingCredentialId: selection.embeddingCredentialId,
          embeddingModel: selection.embeddingModel,
          embeddingDim: dim,
          retrievalThreshold: threshold,
          noAnswerBehavior: body.noAnswerBehavior ?? BOT_DEFAULTS.noAnswerBehavior,
          handoffEnabled: body.handoffEnabled ?? BOT_DEFAULTS.handoffEnabled,
          temperature: body.temperature ?? BOT_DEFAULTS.temperature,
          maxOutputTokens: body.maxOutputTokens ?? BOT_DEFAULTS.maxOutputTokens,
          monthlySpendCapUsd:
            body.monthlySpendCapUsd === undefined
              ? BOT_DEFAULTS.monthlySpendCapUsd
              : usd(body.monthlySpendCapUsd),
          requireChallenge: body.requireChallenge ?? BOT_DEFAULTS.requireChallenge,
          allowedLinkDomains: body.allowedLinkDomains ?? BOT_DEFAULTS.allowedLinkDomains,
          handoffPhrases: body.handoffPhrases ?? BOT_DEFAULTS.handoffPhrases,
          fallbackMessage: body.fallbackMessage ?? BOT_DEFAULTS.fallbackMessage,
          handoffMessage: body.handoffMessage ?? BOT_DEFAULTS.handoffMessage,
          appearance: appearance as unknown as Record<string, unknown>,
        },
        manager,
      );
      // Every bot answers with a prompt version; version 1 is empty until an operator writes
      // instructions (Task 2.9).
      const versionId = await this.repository.insertInitialPromptVersion(
        workspaceId,
        created.id,
        manager,
      );
      const withPrompt = await this.repository.updateById(
        workspaceId,
        created.id,
        { activePromptVersionId: versionId },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.created',
          targetType: 'bot',
          targetId: created.id,
          metadata: { name: created.name },
        },
        manager,
      );
      return withPrompt;
    });
  }

  async list(workspaceId: WorkspaceId): Promise<BotEntity[]> {
    return this.repository.listLive(workspaceId);
  }

  async get(workspaceId: WorkspaceId, botId: string): Promise<BotEntity> {
    return this.getLive(workspaceId, botId);
  }

  async update(
    workspaceId: WorkspaceId,
    botId: string,
    input: UpdateBotRequest,
    actor: UserId,
  ): Promise<BotEntity> {
    const parsed = updateBotSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;

    const existing = await this.getLive(workspaceId, botId);
    if (body.chatCredentialId !== undefined) {
      await this.credential(workspaceId, body.chatCredentialId, 'chat');
      // A model id belongs to a provider: carrying the old one onto a new credential would
      // fail at the first generation instead of here.
      if (body.chatModel === undefined && body.chatCredentialId !== existing.chatCredentialId) {
        throw new AppError('validation_failed', {
          message: 'Choose the model the new credential should use.',
          details: [
            {
              path: 'chatModel',
              message: 'Choose the model the new credential should use.',
            },
          ],
        });
      }
    }

    const patch: QueryDeepPartialEntity<BotEntity> = { updatedAt: this.clock.now() };
    const changed: string[] = [];

    if (body.name !== undefined) {
      patch.name = body.name;
      changed.push('name');
    }
    if (body.allowedOrigins !== undefined) {
      patch.allowedOrigins = body.allowedOrigins.map(normalizeOriginPattern);
      changed.push('allowedOrigins');
    }
    if (body.chatCredentialId !== undefined) {
      patch.chatCredentialId = body.chatCredentialId;
      changed.push('chatCredentialId');
    }
    if (body.chatModel !== undefined) {
      patch.chatModel = body.chatModel;
      changed.push('chatModel');
    }
    if (body.noAnswerBehavior !== undefined) {
      patch.noAnswerBehavior = body.noAnswerBehavior;
      changed.push('noAnswerBehavior');
    }
    if (body.handoffEnabled !== undefined) {
      patch.handoffEnabled = body.handoffEnabled;
      changed.push('handoffEnabled');
    }
    if (body.retrievalThreshold !== undefined) {
      patch.retrievalThreshold = body.retrievalThreshold;
      changed.push('retrievalThreshold');
    }
    if (body.temperature !== undefined) {
      patch.temperature = body.temperature;
      changed.push('temperature');
    }
    if (body.maxOutputTokens !== undefined) {
      patch.maxOutputTokens = body.maxOutputTokens;
      changed.push('maxOutputTokens');
    }
    if (body.monthlySpendCapUsd !== undefined) {
      patch.monthlySpendCapUsd = usd(body.monthlySpendCapUsd);
      changed.push('monthlySpendCapUsd');
    }
    if (body.requireChallenge !== undefined) {
      patch.requireChallenge = body.requireChallenge;
      changed.push('requireChallenge');
    }
    if (body.allowedLinkDomains !== undefined) {
      patch.allowedLinkDomains = body.allowedLinkDomains;
      changed.push('allowedLinkDomains');
    }
    if (body.handoffPhrases !== undefined) {
      patch.handoffPhrases = body.handoffPhrases;
      changed.push('handoffPhrases');
    }
    if (body.fallbackMessage !== undefined) {
      patch.fallbackMessage = body.fallbackMessage;
      changed.push('fallbackMessage');
    }
    if (body.handoffMessage !== undefined) {
      patch.handoffMessage = body.handoffMessage;
      changed.push('handoffMessage');
    }
    if (body.appearance !== undefined) {
      patch.appearance = {
        ...existing.appearance,
        ...body.appearance,
      } as unknown as NonNullable<QueryDeepPartialEntity<BotEntity>['appearance']>;
      changed.push('appearance');
    }

    // A form resends the pair it loaded; a value equal to the stored one is not a change, and
    // must not trip the re-embed guard below on a bot that already has chunks.
    const embeddingInput = {
      embeddingCredentialId:
        body.embeddingCredentialId === existing.embeddingCredentialId
          ? undefined
          : body.embeddingCredentialId,
      embeddingModel:
        body.embeddingModel === existing.embeddingModel ? undefined : body.embeddingModel,
    };
    const embedding = await this.resolveEmbedding(workspaceId, embeddingInput, existing);
    if (embedding !== null) {
      // Spec §12.7: changing the model changes the vector width, so every chunk must be
      // re-embedded. Task 3.10 adds that flow; until then an existing corpus blocks the change.
      if ((await this.repository.countChunks(workspaceId, botId)) > 0) {
        throw new AppError('reembed_not_available');
      }
      patch.embeddingCredentialId = embedding.embeddingCredentialId;
      patch.embeddingModel = embedding.embeddingModel;
      patch.embeddingDim = this.embeddingDim(
        (await this.credentials.get(workspaceId, embedding.embeddingCredentialId)).provider,
        embedding.embeddingModel,
      );
      changed.push(
        ...(embeddingInput.embeddingCredentialId === undefined ? [] : ['embeddingCredentialId']),
        ...(embeddingInput.embeddingModel === undefined ? [] : ['embeddingModel']),
      );
    }

    if (changed.length === 0) return existing;

    return this.ds.transaction(async (manager) => {
      const updated = await this.repository.updateById(workspaceId, botId, patch, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.updated',
          targetType: 'bot',
          targetId: botId,
          metadata: { changed },
        },
        manager,
      );
      return updated;
    });
  }

  /** A new key stops every site still using the old snippet, without disabling the bot. */
  async rotateKey(workspaceId: WorkspaceId, botId: string, actor: UserId): Promise<BotEntity> {
    await this.getLive(workspaceId, botId);

    return this.ds.transaction(async (manager) => {
      const updated = await this.repository.updateById(
        workspaceId,
        botId,
        { publicKey: newPublicKey(), updatedAt: this.clock.now() },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.key_rotated',
          targetType: 'bot',
          targetId: botId,
          metadata: {},
        },
        manager,
      );
      return updated;
    });
  }

  /** Soft delete: the widget and every list stop seeing the bot, and its knowledge is purged. */
  async delete(workspaceId: WorkspaceId, botId: string, actor: UserId): Promise<void> {
    const existing = await this.getLive(workspaceId, botId);

    await this.ds.transaction(async (manager) => {
      await this.repository.updateById(
        workspaceId,
        botId,
        { deletedAt: this.clock.now() },
        manager,
      );
      // The sources outlive the soft delete until this job removes them (spec §12.8); the job
      // commits with the delete, so a rolled-back delete leaves no purge behind.
      await this.jobs.enqueue(
        PURGE_BOT_KNOWLEDGE_JOB,
        { workspaceId, botId },
        { manager, singletonKey: `purge:${botId}` },
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId: actor,
          action: 'bot.deleted',
          targetType: 'bot',
          targetId: botId,
          metadata: { name: existing.name },
        },
        manager,
      );
    });
  }

  /** The widget's only lookup (Milestone 5): by public key, soft-deleted bots never match. */
  async getForWidget(publicKey: string): Promise<BotEntity | null> {
    return this.repository.findByPublicKey(publicKey);
  }

  private async getLive(workspaceId: WorkspaceId, botId: string): Promise<BotEntity> {
    const bot = await this.repository.getById(workspaceId, botId);
    if (bot.deletedAt !== null) throw new AppError('not_found');
    return bot;
  }

  /** The chat credential, or `embeddings_not_supported` when it cannot do what it is for. */
  private async credential(
    workspaceId: WorkspaceId,
    id: string,
    use: 'chat' | 'embedding',
  ): Promise<ProviderCredentialEntity> {
    const credential = await this.credentials.get(workspaceId, id);
    const supported =
      use === 'chat' ? supportsChat(credential.provider) : supportsEmbeddings(credential.provider);
    if (!supported) {
      throw use === 'chat'
        ? new AppError('validation_failed', {
            message: 'This credential cannot chat.',
            details: [{ path: 'chatCredentialId', message: 'This credential cannot chat.' }],
          })
        : new AppError('embeddings_not_supported', {
            details: [{ path: 'embeddingCredentialId', message: 'This credential cannot embed.' }],
          });
    }
    return credential;
  }

  /**
   * The embedding pair to store: an explicit choice wins, otherwise the workspace's built-in
   * `local` credential and this instance's model. `null` on PATCH when nothing changed.
   */
  private async resolveEmbedding(
    workspaceId: WorkspaceId,
    input: { embeddingCredentialId?: string | undefined; embeddingModel?: string | undefined },
    existing: BotEntity,
  ): Promise<EmbeddingSelection | null>;
  private async resolveEmbedding(
    workspaceId: WorkspaceId,
    input: { embeddingCredentialId?: string | undefined; embeddingModel?: string | undefined },
  ): Promise<EmbeddingSelection>;
  private async resolveEmbedding(
    workspaceId: WorkspaceId,
    input: { embeddingCredentialId?: string | undefined; embeddingModel?: string | undefined },
    existing?: BotEntity,
  ): Promise<EmbeddingSelection | null> {
    const changed =
      input.embeddingCredentialId !== undefined ||
      input.embeddingModel !== undefined ||
      existing === undefined;
    if (!changed) return null;

    if (input.embeddingCredentialId !== undefined) {
      await this.credential(workspaceId, input.embeddingCredentialId, 'embedding');
    }

    if (existing === undefined && input.embeddingCredentialId === undefined) {
      const local = await this.credentials.getLocal(workspaceId);
      if (local === null) {
        throw new AppError('validation_failed', {
          message:
            'Local embeddings are disabled on this instance: choose an embedding credential.',
          details: [
            {
              path: 'embeddingCredentialId',
              message: 'Choose the credential this bot should embed with.',
            },
          ],
        });
      }
      return {
        embeddingCredentialId: local.id,
        embeddingModel: input.embeddingModel ?? this.config.localEmbeddingModel,
      };
    }

    return {
      embeddingCredentialId: input.embeddingCredentialId ?? existing?.embeddingCredentialId ?? '',
      embeddingModel: input.embeddingModel ?? existing?.embeddingModel ?? '',
    };
  }

  /**
   * The vector width of a model. A model the catalog does not know is rejected rather than
   * probed: measuring costs a provider call that can fail on a stale key while the admin is
   * saving (Task 2.10 adds the probe path where it belongs).
   */
  private embeddingDim(provider: ProviderKind, model: string): number {
    const info = ModelCatalog.embedding(provider, model);
    if (info === null) {
      throw new AppError('validation_failed', {
        message: 'This embedding model is not in the catalog. Pick one from the model list.',
        details: [
          {
            path: 'embeddingModel',
            message: 'This embedding model is not in the catalog. Pick one from the model list.',
          },
        ],
      });
    }
    return info.dimensions;
  }
}
