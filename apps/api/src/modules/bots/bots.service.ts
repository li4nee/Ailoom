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
import type { BotEntity } from './bot.entity';
import { PURGE_BOT_KNOWLEDGE_JOB, REEMBED_BOT_JOB } from './bots.jobs';
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

    if (body.requireChallenge === true && this.config.challengeSecret === null) {
      throw new AppError('challenge_not_configured');
    }

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
          economyChatCredentialId: null,
          economyChatModel: null,
          embeddingCredentialId: selection.embeddingCredentialId,
          embeddingModel: selection.embeddingModel,
          embeddingDim: dim,
          retrievalThreshold: threshold,
          queryRewritingEnabled: body.queryRewritingEnabled ?? false,
          answerVerificationEnabled: body.answerVerificationEnabled ?? false,
          piiRedactionCategories: body.piiRedactionCategories ?? [],
          noAnswerBehavior: body.noAnswerBehavior ?? BOT_DEFAULTS.noAnswerBehavior,
          handoffEnabled: body.handoffEnabled ?? BOT_DEFAULTS.handoffEnabled,
          csatEnabled: body.csatEnabled ?? BOT_DEFAULTS.csatEnabled,
          temperature: body.temperature ?? BOT_DEFAULTS.temperature,
          maxOutputTokens: body.maxOutputTokens ?? BOT_DEFAULTS.maxOutputTokens,
          monthlySpendCapUsd:
            body.monthlySpendCapUsd === undefined
              ? BOT_DEFAULTS.monthlySpendCapUsd
              : usd(body.monthlySpendCapUsd),
          dailySpendCapUsd:
            body.dailySpendCapUsd === undefined
              ? BOT_DEFAULTS.dailySpendCapUsd
              : usd(body.dailySpendCapUsd),
          requireChallenge: body.requireChallenge ?? BOT_DEFAULTS.requireChallenge,
          allowedLinkDomains: body.allowedLinkDomains ?? BOT_DEFAULTS.allowedLinkDomains,
          handoffPhrases: body.handoffPhrases ?? BOT_DEFAULTS.handoffPhrases,
          fallbackMessage: body.fallbackMessage ?? BOT_DEFAULTS.fallbackMessage,
          handoffMessage: body.handoffMessage ?? BOT_DEFAULTS.handoffMessage,
          appearance: appearance as unknown as Record<string, unknown>,
          widgetInteractions: body.widgetInteractions ?? {
            cards: [],
            quickReplies: [],
            form: null,
          },
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

  /** Unknown/custom model IDs are not assumed to support tool calling. */
  async supportsToolCalling(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    const bot = await this.getLive(workspaceId, botId);
    const primary = await this.credentials.get(workspaceId, bot.chatCredentialId);
    if (!ModelCatalog.supportsToolCalling(primary.provider, bot.chatModel)) return false;
    if (bot.fallbackChatCredentialId === null || bot.fallbackChatModel === null) return true;
    const fallback = await this.credentials.get(workspaceId, bot.fallbackChatCredentialId);
    return ModelCatalog.supportsToolCalling(fallback.provider, bot.fallbackChatModel);
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

    if (body.requireChallenge === true && this.config.challengeSecret === null) {
      throw new AppError('challenge_not_configured');
    }

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

    const nextPrimary = {
      credentialId: body.chatCredentialId ?? existing.chatCredentialId,
      model: body.chatModel ?? existing.chatModel,
    };
    const existingEconomyCredentialId = existing.economyChatCredentialId ?? null;
    const existingEconomyModel = existing.economyChatModel ?? null;
    let nextEconomy: { credentialId: string; model: string } | null;
    if (body.economy === undefined) {
      nextEconomy =
        existingEconomyCredentialId === null || existingEconomyModel === null
          ? null
          : { credentialId: existingEconomyCredentialId, model: existingEconomyModel };
    } else if (body.economy === null) {
      nextEconomy = null;
    } else {
      nextEconomy = {
        credentialId: body.economy.chatCredentialId,
        model: body.economy.chatModel,
      };
    }
    if (body.economy !== undefined && body.economy !== null) {
      try {
        await this.credential(workspaceId, body.economy.chatCredentialId, 'chat');
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') {
          throw new AppError('validation_failed', {
            details: [
              {
                path: 'economy.chatCredentialId',
                message: 'Choose a chat credential in this workspace.',
              },
            ],
          });
        }
        throw error;
      }
    }
    if (
      nextEconomy !== null &&
      nextEconomy.credentialId === nextPrimary.credentialId &&
      nextEconomy.model === nextPrimary.model
    ) {
      throw new AppError('validation_failed', {
        details: [
          { path: 'economy', message: 'Choose an economy model different from the primary model.' },
        ],
      });
    }
    let nextFallback: { credentialId: string; model: string } | null;
    if (body.fallback === undefined) {
      nextFallback =
        existing.fallbackChatCredentialId === null || existing.fallbackChatModel === null
          ? null
          : {
              credentialId: existing.fallbackChatCredentialId,
              model: existing.fallbackChatModel,
            };
    } else if (body.fallback === null) {
      nextFallback = null;
    } else {
      nextFallback = {
        credentialId: body.fallback.chatCredentialId,
        model: body.fallback.chatModel,
      };
    }
    if (body.fallback !== undefined && body.fallback !== null) {
      try {
        await this.credential(workspaceId, body.fallback.chatCredentialId, 'chat');
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') {
          throw new AppError('validation_failed', {
            message: 'Choose a chat credential in this workspace.',
            details: [
              {
                path: 'fallback.chatCredentialId',
                message: 'Choose a chat credential in this workspace.',
              },
            ],
          });
        }
        throw error;
      }
    }
    if (
      nextFallback !== null &&
      nextFallback.credentialId === nextPrimary.credentialId &&
      nextFallback.model === nextPrimary.model
    ) {
      throw new AppError('validation_failed', {
        message: 'Choose a fallback model different from the primary model.',
        details: [
          {
            path: 'fallback',
            message: 'Choose a fallback model different from the primary model.',
          },
        ],
      });
    }
    if (
      nextFallback !== null &&
      nextEconomy !== null &&
      nextFallback.credentialId === nextEconomy.credentialId &&
      nextFallback.model === nextEconomy.model
    ) {
      throw new AppError('validation_failed', {
        details: [
          {
            path: 'fallback',
            message: 'Choose a fallback model different from the economy model.',
          },
        ],
      });
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
    if (body.fallback !== undefined) {
      patch.fallbackChatCredentialId = body.fallback?.chatCredentialId ?? null;
      patch.fallbackChatModel = body.fallback?.chatModel ?? null;
      changed.push('fallback');
    }
    if (body.economy !== undefined) {
      patch.economyChatCredentialId = body.economy?.chatCredentialId ?? null;
      patch.economyChatModel = body.economy?.chatModel ?? null;
      changed.push('economy');
    }
    if (body.noAnswerBehavior !== undefined) {
      patch.noAnswerBehavior = body.noAnswerBehavior;
      changed.push('noAnswerBehavior');
    }
    if (body.handoffEnabled !== undefined) {
      patch.handoffEnabled = body.handoffEnabled;
      changed.push('handoffEnabled');
    }
    if (body.csatEnabled !== undefined) {
      patch.csatEnabled = body.csatEnabled;
      changed.push('csatEnabled');
    }
    if (body.automaticHandoffSummaries !== undefined) {
      patch.automaticHandoffSummaries = body.automaticHandoffSummaries;
      changed.push('automaticHandoffSummaries');
    }
    if (body.suggestedRepliesEnabled !== undefined) {
      patch.suggestedRepliesEnabled = body.suggestedRepliesEnabled;
      changed.push('suggestedRepliesEnabled');
    }
    if (body.agentAssistEnabled !== undefined) {
      patch.agentAssistEnabled = body.agentAssistEnabled;
      changed.push('agentAssistEnabled');
    }
    if (body.retrievalThreshold !== undefined) {
      patch.retrievalThreshold = body.retrievalThreshold;
      changed.push('retrievalThreshold');
    }
    if (body.retrievalMode !== undefined) {
      patch.retrievalMode = body.retrievalMode;
      changed.push('retrievalMode');
    }
    if (body.rerankingEnabled !== undefined) {
      patch.rerankingEnabled = body.rerankingEnabled;
      changed.push('rerankingEnabled');
    }
    if (body.queryRewritingEnabled !== undefined) {
      patch.queryRewritingEnabled = body.queryRewritingEnabled;
      changed.push('queryRewritingEnabled');
    }
    if (body.answerVerificationEnabled !== undefined) {
      patch.answerVerificationEnabled = body.answerVerificationEnabled;
      changed.push('answerVerificationEnabled');
    }
    if (body.piiRedactionCategories !== undefined) {
      patch.piiRedactionCategories = body.piiRedactionCategories;
      changed.push('piiRedactionCategories');
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
    if (body.dailySpendCapUsd !== undefined) {
      patch.dailySpendCapUsd = usd(body.dailySpendCapUsd);
      changed.push('dailySpendCapUsd');
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
    if (body.widgetInteractions !== undefined) {
      patch.widgetInteractions = body.widgetInteractions as unknown as NonNullable<
        QueryDeepPartialEntity<BotEntity>['widgetInteractions']
      >;
      changed.push('widgetInteractions');
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
    let reembed: { credentialId: string; model: string; dim: number } | null = null;
    let directEmbedding = false;
    if (embedding !== null) {
      const dim = this.embeddingDim(
        (await this.credentials.get(workspaceId, embedding.embeddingCredentialId)).provider,
        embedding.embeddingModel,
      );
      // Spec §12.7: with a corpus to migrate the new model becomes pending and a job re-embeds
      // it; the bot keeps answering with the old one until the swap.
      if ((await this.repository.countChunks(workspaceId, botId)) > 0) {
        reembed = {
          credentialId: embedding.embeddingCredentialId,
          model: embedding.embeddingModel,
          dim,
        };
      } else {
        patch.embeddingCredentialId = embedding.embeddingCredentialId;
        patch.embeddingModel = embedding.embeddingModel;
        patch.embeddingDim = dim;
        directEmbedding = true;
      }
      changed.push(
        ...(embeddingInput.embeddingCredentialId === undefined ? [] : ['embeddingCredentialId']),
        ...(embeddingInput.embeddingModel === undefined ? [] : ['embeddingModel']),
      );
    }

    if (changed.length === 0) return existing;

    return this.ds.transaction(async (manager) => {
      // Before the update, so the returned row already carries the pending model. No singleton
      // key: the newest start must run to cancel an older one through the generation bump.
      let generation: number | null = null;
      if (directEmbedding) {
        // No corpus to migrate, so the change applies now; a still-pending re-embed from an
        // earlier change must not be able to swap the bot back afterwards (spec §12.7).
        await this.repository.clearReembedPending(manager, workspaceId, botId);
      }
      if (reembed !== null) {
        generation = await this.repository.markReembedPending(manager, {
          workspaceId,
          botId,
          ...reembed,
        });
      }
      const updated = await this.repository.updateById(workspaceId, botId, patch, manager);
      if (reembed !== null && generation !== null) {
        await this.jobs.enqueue(
          REEMBED_BOT_JOB,
          {
            workspaceId,
            botId,
            targetModel: reembed.model,
            targetCredentialId: reembed.credentialId,
            generation,
          },
          { manager },
        );
      }
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
