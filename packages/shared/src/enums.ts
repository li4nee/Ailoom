// SPDX-License-Identifier: MIT

/** Workspace roles, most privileged first. Also the labels of the Postgres `role` enum. */
export const ROLES = ['owner', 'admin', 'agent'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invitation can grant: ownership is never handed out by invitation. */
export const INVITATION_ROLES = ['admin', 'agent'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/** Purposes of a single-use email token. Also the labels of the Postgres `email_token_type` enum. */
export const EMAIL_TOKEN_TYPES = ['verify_email', 'reset_password'] as const;
export type EmailTokenType = (typeof EMAIL_TOKEN_TYPES)[number];

/** Kinds of knowledge source (spec §9.3). Also the labels of the Postgres `source_type` enum. */
export const SOURCE_TYPES = ['text', 'file', 'url', 'sitemap'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Ingestion state of a knowledge source. Postgres enum `source_status`. */
export const SOURCE_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Freshness state of a document (Phase 2). Postgres enum `document_status`. */
export const DOCUMENT_STATUSES = ['active', 'unreachable', 'removed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Warnings recorded on a document version during extraction (spec §12.3). */
export const EXTRACTION_WARNINGS = [
  'js_rendered_suspected',
  'pdf_no_text_layer',
  'truncated',
  'low_text_content',
] as const;
export type ExtractionWarning = (typeof EXTRACTION_WARNINGS)[number];

/** Who is answering a conversation. Postgres enum `conversation_status`. */
export const CONVERSATION_STATUSES = ['ai', 'needs_human', 'human', 'closed'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Why a conversation was handed to a human (spec §14). Postgres enum `handoff_reason`. */
export const HANDOFF_REASONS = [
  'visitor_request',
  'handoff_intent',
  'no_answer',
  'negative_feedback',
  'agent_takeover',
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

/** Author of a message. Postgres enum `message_role`. */
export const MESSAGE_ROLES = ['visitor', 'ai', 'agent', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Delivery state of a message. Postgres enum `message_status`. */
export const MESSAGE_STATUSES = ['streaming', 'complete', 'error'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Outcome of one answer attempt. Postgres enum `trace_decision`. */
export const TRACE_DECISIONS = ['answered', 'escalated', 'refused', 'error'] as const;
export type TraceDecision = (typeof TRACE_DECISIONS)[number];

/** Where an answer attempt came from. Postgres enum `trace_origin`. */
export const TRACE_ORIGINS = ['widget', 'playground'] as const;
export type TraceOrigin = (typeof TRACE_ORIGINS)[number];

/** What a bot does when it finds no answer. Postgres enum `no_answer_behavior`. */
export const NO_ANSWER_BEHAVIORS = ['fallback_message', 'offer_handoff', 'auto_handoff'] as const;
export type NoAnswerBehavior = (typeof NO_ANSWER_BEHAVIORS)[number];

/** Conversation priority (Phase 5 SLA). Postgres enum `priority`. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Channels a conversation arrives on. Postgres enum `channel`. */
export const CHANNELS = ['web'] as const;
export type Channel = (typeof CHANNELS)[number];
