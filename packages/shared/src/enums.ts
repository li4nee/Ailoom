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

/** Provider types for credentials. */
export const PROVIDER_KINDS = [
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'mistral',
  'ollama',
  'openai_compatible',
  'local',
  'mock',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Knowledge source types. */
export const SOURCE_TYPES = [
  'web',
  'file',
  'github',
  'notion',
  'confluence',
  'google_drive',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Knowledge source sync statuses. */
export const SOURCE_STATUSES = ['pending', 'syncing', 'completed', 'failed', 'archived'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Document processing statuses. */
export const DOCUMENT_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'archived',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Extraction warnings for documents. */
export const EXTRACTION_WARNINGS = [
  'js_rendered_suspected',
  'pdf_no_text_layer',
  'truncated',
  'low_text_content',
] as const;
export type ExtractionWarning = (typeof EXTRACTION_WARNINGS)[number];

/** Conversation statuses. */
export const CONVERSATION_STATUSES = ['ai', 'needs_human', 'human', 'closed'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Handoff reasons. */
export const HANDOFF_REASONS = [
  'visitor_request',
  'handoff_intent',
  'no_answer',
  'negative_feedback',
  'agent_takeover',
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

/** Message roles. */
export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Message statuses. */
export const MESSAGE_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Trace decisions. */
export const TRACE_DECISIONS = ['answered', 'escalated', 'refused', 'error'] as const;
export type TraceDecision = (typeof TRACE_DECISIONS)[number];

/** Trace origins. */
export const TRACE_ORIGINS = ['widget', 'playground'] as const;
export type TraceOrigin = (typeof TRACE_ORIGINS)[number];

/** No-answer behaviors. */
export const NO_ANSWER_BEHAVIORS = ['handoff', 'retry', 'escalate'] as const;
export type NoAnswerBehavior = (typeof NO_ANSWER_BEHAVIORS)[number];

/** Priority levels. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Channels. */
export const CHANNELS = ['web'] as const;
export type Channel = (typeof CHANNELS)[number];
