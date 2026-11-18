// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { citationSchema } from './citations.js';
import { CONVERSATION_STATUSES, MESSAGE_ROLES, MESSAGE_STATUSES, PRIORITIES } from './enums.js';
import { pageQuerySchema } from './pagination.js';
import { ratingSchema } from './ratings.js';

/** `POST …/conversations/:conversationId/messages`: an agent's reply. */
export const agentMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
});

/** Filters accepted by `GET /api/v1/workspaces/:workspaceId/conversations`. */
export const conversationInboxQuerySchema = pageQuerySchema.extend({
  botId: z.uuid().optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  /** `me`, `none`, or a workspace member's id. */
  assignedTo: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  q: z.string().trim().min(1).max(500).optional(),
});

const assigneeSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const inboxContactSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
});

const conversationContactSchema = inboxContactSchema.extend({
  externalId: z.string().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});

const conversationHistoryItemSchema = z.object({
  id: z.string(),
  botName: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
  assignedTo: assigneeSchema.nullable(),
  priority: z.enum(PRIORITIES),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string(),
});

/** Assigns or releases a conversation using optimistic workflow concurrency. */
export const conversationAssignmentRequestSchema = z.object({
  assignedUserId: z.uuid().nullable(),
  expectedWorkflowVersion: z.number().int().min(1),
  mutationId: z.uuid(),
});

export const conversationAssignmentResponseSchema = z.object({
  assignedTo: assigneeSchema.nullable(),
  status: z.enum(CONVERSATION_STATUSES),
  workflowVersion: z.number().int().min(1),
});

export const conversationPriorityRequestSchema = z.object({
  priority: z.enum(PRIORITIES),
  expectedWorkflowVersion: z.number().int().min(1),
  mutationId: z.uuid(),
});

export const conversationPriorityResponseSchema = z.object({
  priority: z.enum(PRIORITIES),
  workflowVersion: z.number().int().min(1),
});

/** One row of the agent inbox (spec §17.7). */
export const conversationListItemSchema = z.object({
  id: z.string(),
  botId: z.string(),
  botName: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
  workflowVersion: z.number().int().min(1),
  priority: z.enum(PRIORITIES),
  contact: inboxContactSchema,
  assignedTo: assigneeSchema.nullable(),
  handoffReason: z.string().nullable(),
  handoffRequestedAt: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string(),
  unansweredByHuman: z.boolean(),
});

/** Badge counts for the inbox navigation. `mine` excludes closed conversations. */
export const conversationCountsSchema = z.object({
  needsHuman: z.number().int(),
  mine: z.number().int(),
});

/** One message in the admin conversation timeline. AI answers carry their trace id. */
export const adminMessageSchema = z.object({
  id: z.string(),
  role: z.enum(MESSAGE_ROLES),
  content: z.string(),
  citations: z.array(citationSchema).nullable(),
  status: z.enum(MESSAGE_STATUSES),
  feedback: ratingSchema.nullable(),
  author: assigneeSchema.nullable(),
  traceId: z.string().nullable(),
  createdAt: z.string(),
});

/** `POST …/takeover`, `/handback` and `/close` return the new conversation status. */
export const conversationStatusResponseSchema = z.object({
  status: z.enum(CONVERSATION_STATUSES),
});

/** The conversation header; contact details are returned alongside it in the detail response. */
export const adminConversationSchema = z.object({
  id: z.string(),
  botId: z.string(),
  botName: z.string(),
  channel: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
  workflowVersion: z.number().int().min(1),
  assignedTo: assigneeSchema.nullable(),
  handoffReason: z.string().nullable(),
  handoffRequestedAt: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  lastMessageAt: z.string(),
  closedAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

/** `GET …/conversations/:conversationId`: every message, oldest first. */
export const conversationDetailSchema = z.object({
  conversation: adminConversationSchema,
  contact: conversationContactSchema,
  contactHistory: z.array(conversationHistoryItemSchema),
  messages: z.array(adminMessageSchema),
});

export type AgentMessageRequest = z.infer<typeof agentMessageRequestSchema>;
export type ConversationAssignmentRequest = z.infer<typeof conversationAssignmentRequestSchema>;
export type ConversationAssignmentResponse = z.infer<typeof conversationAssignmentResponseSchema>;
export type ConversationPriorityRequest = z.infer<typeof conversationPriorityRequestSchema>;
export type ConversationPriorityResponse = z.infer<typeof conversationPriorityResponseSchema>;
export type ConversationStatusResponse = z.infer<typeof conversationStatusResponseSchema>;
export type ConversationInboxQuery = z.infer<typeof conversationInboxQuerySchema>;
export type ConversationListItem = z.infer<typeof conversationListItemSchema>;
export type ConversationCounts = z.infer<typeof conversationCountsSchema>;
export type AdminMessage = z.infer<typeof adminMessageSchema>;
export type AdminConversation = z.infer<typeof adminConversationSchema>;
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
