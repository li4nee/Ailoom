// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { NO_ANSWER_BEHAVIORS } from './enums.js';
import { evalGateSchema } from './eval.js';
import { RETRIEVAL_MODES } from './retrieval.js';

/** An allowed origin: scheme and host only — the API normalizes it before storing. */
const originSchema = z.string().trim().min(1).max(255);

const themeColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb color, e.g. #c7f36b');

/** Avatar and privacy links are opened by visitors: plaintext `http` would leak the session. */
const httpsUrlSchema = z.url({ protocol: /^https$/ }).max(2048);

/** Widget look and copy (spec §9.2 `appearance`). */
export const appearanceSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  themeColor: themeColorSchema,
  position: z.enum(['right', 'left']),
  welcomeMessage: z.string().trim().min(1).max(500),
  avatarUrl: httpsUrlSchema.nullable(),
  privacyUrl: httpsUrlSchema.nullable(),
});

/** The settings an operator may change after creation; every one is optional on the wire. */
export const botSettingsSchema = z.object({
  allowedOrigins: z.array(originSchema).max(50),
  noAnswerBehavior: z.enum(NO_ANSWER_BEHAVIORS),
  handoffEnabled: z.boolean(),
  csatEnabled: z.boolean(),
  /** Agent-assist controls are opt-in and are never sent to the public widget. */
  automaticHandoffSummaries: z.boolean(),
  suggestedRepliesEnabled: z.boolean(),
  agentAssistEnabled: z.boolean(),
  retrievalThreshold: z.number().min(0).max(1),
  retrievalMode: z.enum(RETRIEVAL_MODES),
  rerankingEnabled: z.boolean(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().min(64).max(4000),
  monthlySpendCapUsd: z.number().min(0).max(1_000_000).nullable(),
  requireChallenge: z.boolean(),
  allowedLinkDomains: z.array(z.string().trim().min(1).max(253)).max(50),
  handoffPhrases: z.array(z.string().trim().min(2).max(60)).min(1).max(50).nullable(),
  fallbackMessage: z.string().trim().min(1).max(1000),
  handoffMessage: z.string().trim().min(1).max(1000),
  appearance: appearanceSchema,
});

/** `POST /workspaces/:ws/bots`. Everything but the chat selection falls back to the defaults. */
export const createBotSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    chatCredentialId: z.uuid(),
    chatModel: z.string().trim().min(1).max(200),
    embeddingCredentialId: z.uuid().optional(),
    embeddingModel: z.string().trim().min(1).max(200).optional(),
  })
  .extend(botSettingsSchema.partial().shape);

/**
 * `PATCH /workspaces/:ws/bots/:botId`. An appearance override is merged, not replaced, so the
 * widget settings form can send a single changed key.
 */
export const updateBotSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    chatCredentialId: z.uuid(),
    chatModel: z.string().trim().min(1).max(200),
    embeddingCredentialId: z.uuid(),
    embeddingModel: z.string().trim().min(1).max(200),
  })
  .extend(botSettingsSchema.shape)
  .partial()
  .extend({
    appearance: appearanceSchema.partial().optional(),
    fallback: z
      .object({ chatCredentialId: z.uuid(), chatModel: z.string().trim().min(1).max(200) })
      .nullable()
      .optional(),
  });

/** A bot as the API returns it; `publicKey` is the only value the widget snippet needs. */
export const botDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  publicKey: z.string(),
  allowedOrigins: z.array(z.string()),
  chatCredentialId: z.string(),
  chatModel: z.string(),
  fallbackChatCredentialId: z.string().nullable(),
  fallbackChatModel: z.string().nullable(),
  embeddingCredentialId: z.string(),
  embeddingModel: z.string(),
  embeddingDim: z.number().int(),
  /** Non-null while a re-embed is running; the bot still answers with `embeddingModel`. */
  pendingEmbeddingModel: z.string().nullable(),
  /** Why the last re-embed failed; null once a new one starts. */
  lastError: z.string().nullable(),
  /** The prompt version the bot answers with; Task 2.9 keeps it pointed at the newest. */
  activePromptVersionId: z.string().nullable(),
  evalGate: evalGateSchema,
  retrievalThreshold: z.number(),
  retrievalMode: z.enum(RETRIEVAL_MODES),
  rerankingEnabled: z.boolean(),
  noAnswerBehavior: z.enum(NO_ANSWER_BEHAVIORS),
  handoffEnabled: z.boolean(),
  csatEnabled: z.boolean(),
  automaticHandoffSummaries: z.boolean(),
  suggestedRepliesEnabled: z.boolean(),
  agentAssistEnabled: z.boolean(),
  temperature: z.number(),
  maxOutputTokens: z.number().int(),
  monthlySpendCapUsd: z.string().nullable(),
  requireChallenge: z.boolean(),
  allowedLinkDomains: z.array(z.string()),
  handoffPhrases: z.array(z.string()).nullable(),
  fallbackMessage: z.string(),
  handoffMessage: z.string(),
  appearance: appearanceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Appearance = z.infer<typeof appearanceSchema>;
export type BotSettings = z.infer<typeof botSettingsSchema>;
export type CreateBotRequest = z.infer<typeof createBotSchema>;
export type UpdateBotRequest = z.infer<typeof updateBotSchema>;
export type BotDto = z.infer<typeof botDtoSchema>;
