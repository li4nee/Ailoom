// SPDX-License-Identifier: AGPL-3.0-only
import { appearanceSchema, type BotDto, widgetInteractionsSchema } from '@app/shared';

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
    economyChatCredentialId: bot.economyChatCredentialId,
    economyChatModel: bot.economyChatModel,
    embeddingCredentialId: bot.embeddingCredentialId,
    embeddingModel: bot.embeddingModel,
    embeddingDim: bot.embeddingDim,
    pendingEmbeddingModel: bot.pendingEmbeddingModel,
    lastError: bot.lastError,
    activePromptVersionId: bot.activePromptVersionId,
    evalGate: bot.evalGate,
    retrievalThreshold: bot.retrievalThreshold,
    retrievalMode: bot.retrievalMode,
    rerankingEnabled: bot.rerankingEnabled,
    queryRewritingEnabled: bot.queryRewritingEnabled,
    answerVerificationEnabled: bot.answerVerificationEnabled,
    noAnswerBehavior: bot.noAnswerBehavior,
    handoffEnabled: bot.handoffEnabled,
    csatEnabled: bot.csatEnabled,
    automaticHandoffSummaries: bot.automaticHandoffSummaries,
    suggestedRepliesEnabled: bot.suggestedRepliesEnabled,
    agentAssistEnabled: bot.agentAssistEnabled,
    temperature: bot.temperature,
    maxOutputTokens: bot.maxOutputTokens,
    monthlySpendCapUsd: bot.monthlySpendCapUsd,
    dailySpendCapUsd: bot.dailySpendCapUsd,
    requireChallenge: bot.requireChallenge,
    allowedLinkDomains: bot.allowedLinkDomains,
    handoffPhrases: bot.handoffPhrases,
    fallbackMessage: bot.fallbackMessage ?? '',
    handoffMessage: bot.handoffMessage ?? '',
    appearance: appearanceSchema.parse(bot.appearance),
    widgetInteractions: widgetInteractionsSchema.parse(bot.widgetInteractions),
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
  };
}
