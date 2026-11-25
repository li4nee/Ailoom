// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** The bot's instructions, in characters: enough for a page of guidance, small enough to send. */
export const SYSTEM_PROMPT_MAX = 8000;

/** `POST /workspaces/:ws/bots/:botId/prompt-versions`. A version is never edited afterwards. */
export const createPromptVersionSchema = z.object({
  systemPrompt: z.string().max(SYSTEM_PROMPT_MAX),
  note: z.string().trim().min(1).max(200).optional(),
  /** False saves a draft for evaluation without changing the live bot prompt. */
  activate: z.boolean().default(true),
});

/** One version as the API returns it. `version` increments per bot, starting at 1. */
export const promptVersionDtoSchema = z.object({
  id: z.string(),
  botId: z.string(),
  version: z.number().int(),
  systemPrompt: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export type CreatePromptVersionRequest = z.infer<typeof createPromptVersionSchema>;
export type PromptVersionDto = z.infer<typeof promptVersionDtoSchema>;
