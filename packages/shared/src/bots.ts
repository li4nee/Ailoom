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

const interactionId = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/);
const interactionCardSchema = z
  .object({
    id: interactionId,
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240),
    imageUrl: httpsUrlSchema.nullable(),
    imageAlt: z.string().trim().max(120),
    linkUrl: httpsUrlSchema,
    linkLabel: z.string().trim().min(1).max(30),
  })
  .strict();
const quickReplySchema = z
  .object({
    id: interactionId,
    label: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(1).max(300),
  })
  .strict();
const textFieldSchema = z
  .object({
    id: interactionId,
    label: z.string().trim().min(1).max(60),
    type: z.enum(['text', 'email']),
    required: z.boolean(),
  })
  .strict();
const selectFieldSchema = z
  .object({
    id: interactionId,
    label: z.string().trim().min(1).max(60),
    type: z.literal('select'),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(8),
  })
  .strict();
const formFieldSchema = z.discriminatedUnion('type', [textFieldSchema, selectFieldSchema]);

/** Safe, admin-authored visitor interactions. No model-defined actions or destinations. */
export const widgetInteractionsSchema = z
  .object({
    cards: z.array(interactionCardSchema).max(8),
    quickReplies: z.array(quickReplySchema).max(6),
    form: z
      .object({
        title: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
        submitLabel: z.string().trim().min(1).max(30),
        fields: z.array(formFieldSchema).min(1).max(5),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((interactions, context) => {
    const checkUniqueIds = (items: { id: string }[], path: (string | number)[]): void => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (seen.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: [...path, index, 'id'],
            message: 'IDs must be unique within this interaction list.',
          });
        }
        seen.add(item.id);
      }
    };

    checkUniqueIds(interactions.cards, ['cards']);
    checkUniqueIds(interactions.quickReplies, ['quickReplies']);
    if (interactions.form !== null) {
      checkUniqueIds(interactions.form.fields, ['form', 'fields']);
      for (const [fieldIndex, field] of interactions.form.fields.entries()) {
        if (field.type !== 'select') continue;
        const options = field.options.map((option) => option.toLowerCase());
        if (new Set(options).size !== options.length) {
          context.addIssue({
            code: 'custom',
            path: ['form', 'fields', fieldIndex, 'options'],
            message: 'Select options must be unique.',
          });
        }
      }
    }
  });

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
  queryRewritingEnabled: z.boolean(),
  answerVerificationEnabled: z.boolean(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().min(64).max(4000),
  monthlySpendCapUsd: z.number().min(0).max(1_000_000).nullable(),
  dailySpendCapUsd: z.number().min(0).max(1_000_000).nullable(),
  requireChallenge: z.boolean(),
  allowedLinkDomains: z.array(z.string().trim().min(1).max(253)).max(50),
  handoffPhrases: z.array(z.string().trim().min(2).max(60)).min(1).max(50).nullable(),
  fallbackMessage: z.string().trim().min(1).max(1000),
  handoffMessage: z.string().trim().min(1).max(1000),
  appearance: appearanceSchema,
  widgetInteractions: widgetInteractionsSchema,
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
    economy: z
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
  economyChatCredentialId: z.string().nullable().optional(),
  economyChatModel: z.string().nullable().optional(),
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
  queryRewritingEnabled: z.boolean(),
  answerVerificationEnabled: z.boolean(),
  noAnswerBehavior: z.enum(NO_ANSWER_BEHAVIORS),
  handoffEnabled: z.boolean(),
  csatEnabled: z.boolean(),
  automaticHandoffSummaries: z.boolean(),
  suggestedRepliesEnabled: z.boolean(),
  agentAssistEnabled: z.boolean(),
  temperature: z.number(),
  maxOutputTokens: z.number().int(),
  monthlySpendCapUsd: z.string().nullable(),
  dailySpendCapUsd: z.string().nullable().optional(),
  requireChallenge: z.boolean(),
  allowedLinkDomains: z.array(z.string()),
  handoffPhrases: z.array(z.string()).nullable(),
  fallbackMessage: z.string(),
  handoffMessage: z.string(),
  appearance: appearanceSchema,
  widgetInteractions: widgetInteractionsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Appearance = z.infer<typeof appearanceSchema>;
export type WidgetInteractions = z.infer<typeof widgetInteractionsSchema>;
export type BotSettings = z.infer<typeof botSettingsSchema>;
export type CreateBotRequest = z.infer<typeof createBotSchema>;
export type UpdateBotRequest = z.infer<typeof updateBotSchema>;
export type BotDto = z.infer<typeof botDtoSchema>;
