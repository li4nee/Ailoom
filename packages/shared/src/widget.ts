// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { emailSchema } from './auth.js';
import { CONVERSATION_STATUSES, MESSAGE_ROLES, MESSAGE_STATUSES } from './enums.js';

/** `POST /api/widget/v1/sessions`; a saved `token` resumes the same contact (spec §17.9). */
export const createSessionSchema = z.object({
  publicKey: z.string().trim().min(1).max(255),
  token: z.string().min(1).max(4096).optional(),
  challenge: z.string().min(1).max(16384).optional(),
});

/** The body of a successful session create: a fresh visitor JWT and its contact. */
export const sessionResponseSchema = z.object({
  token: z.string(),
  contactId: z.string(),
});

/** The look and feature flags the widget renders with (spec §16.1). */
export const widgetConfigSchema = z.object({
  displayName: z.string(),
  themeColor: z.string(),
  textColor: z.string(),
  avatarUrl: z.string().nullable(),
  position: z.enum(['right', 'left']),
  welcomeMessage: z.string(),
  privacyUrl: z.string().nullable(),
  handoffEnabled: z.boolean(),
  feedbackEnabled: z.boolean(),
  requireChallenge: z.boolean(),
});

/** One source an AI answer cites, as shown in the widget. */
const citationSchema = z.object({
  n: z.number().int(),
  chunkId: z.string(),
  documentId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

/** One message the widget shows; `citations` and `feedback` are only set on AI answers. */
export const widgetMessageSchema = z.object({
  id: z.string(),
  role: z.enum(MESSAGE_ROLES),
  content: z.string(),
  citations: z.array(citationSchema).nullable(),
  status: z.enum(MESSAGE_STATUSES),
  feedback: z.union([z.literal(1), z.literal(-1)]).nullable(),
  createdAt: z.string(),
});

/** `GET /api/widget/v1/conversations/current`; messages run oldest first. */
export const widgetConversationSchema = z.object({
  id: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
  messages: z.array(widgetMessageSchema),
});

/** Where a conversation started: the host page URL and locale, if the widget knew them. */
export const conversationMetadataSchema = z.object({
  pageUrl: z.string().max(2000).optional(),
  locale: z.string().trim().min(2).max(35).optional(),
});

/** `POST /api/widget/v1/conversations`; the body may be empty (spec §17.9). */
export const createConversationSchema = z
  .object({ metadata: conversationMetadataSchema.optional() })
  .default({});

/** `POST /api/widget/v1/conversations/:conversationId/messages` (spec §17.9). */
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

/** `POST /api/widget/v1/conversations/:conversationId/handoff`; the email is optional. */
export const handoffSchema = z.object({
  email: emailSchema.optional(),
});

/** `POST /api/widget/v1/messages/:messageId/feedback`; thumbs up or down only. */
export const feedbackSchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
});

export type CreateSessionRequest = z.infer<typeof createSessionSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;
export type WidgetMessage = z.infer<typeof widgetMessageSchema>;
export type WidgetConversation = z.infer<typeof widgetConversationSchema>;
export type ConversationMetadata = z.infer<typeof conversationMetadataSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;
export type HandoffRequest = z.infer<typeof handoffSchema>;
export type FeedbackRequest = z.infer<typeof feedbackSchema>;
