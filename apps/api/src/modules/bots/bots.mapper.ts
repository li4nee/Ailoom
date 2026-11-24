// SPDX-License-Identifier: AGPL-3.0-only
import { appearanceSchema, type BotDto } from '@app/shared';

import type { BotEntity } from './bot.entity';

/** The API shape of a bot. `appearance` is jsonb, so it is validated as it leaves the row. */
export function toBotDto(bot: BotEntity): BotDto {
  return {
    id: bot.id,
    name: bot.name,
    publicKey: bot.publicKey,
    allowedOrigins: bot.allowedOrigins,
    chatCredentialId: bot.chatCredentialId,
    chatModel: bot.chatModel,
    fallbackChatCredentialId: bot.fallbackChatCredentialId,
    fallbackChatModel: bot.fallbackChatModel,
    embeddingCredentialId: bot.embeddingCredentialId,
    embeddingModel: bot.embeddingModel,
    embeddingDim: bot.embeddingDim,
    pendingEmbeddingModel: bot.pendingEmbeddingModel,
    lastError: bot.lastError,
    activePromptVersionId: bot.activePromptVersionId,
    retrievalThreshold: bot.retrievalThreshold,
    noAnswerBehavior: bot.noAnswerBehavior,
    handoffEnabled: bot.handoffEnabled,
    automaticHandoffSummaries: bot.automaticHandoffSummaries,
    suggestedRepliesEnabled: bot.suggestedRepliesEnabled,
    agentAssistEnabled: bot.agentAssistEnabled,
    temperature: bot.temperature,
    maxOutputTokens: bot.maxOutputTokens,
    monthlySpendCapUsd: bot.monthlySpendCapUsd,
    requireChallenge: bot.requireChallenge,
    allowedLinkDomains: bot.allowedLinkDomains,
    handoffPhrases: bot.handoffPhrases,
    fallbackMessage: bot.fallbackMessage ?? '',
    handoffMessage: bot.handoffMessage ?? '',
    appearance: appearanceSchema.parse(bot.appearance),
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
  };
}
