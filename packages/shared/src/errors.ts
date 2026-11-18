// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** Every error code the API can return. Later milestones append to this list. */
export const ERROR_CODES = [
  'validation_failed',
  'password_policy',
  'signup_closed',
  'invitation_required',
  'email_taken',
  'invalid_credentials',
  'token_expired',
  'session_expired',
  'session_revoked',
  'refresh_race',
  'csrf_failed',
  'invalid_token',
  'sole_owner',
  'cannot_modify_owner',
  'email_not_verified',
  'credential_in_use',
  'credential_builtin',
  'embeddings_not_supported',
  'reembed_not_available',
  'blocked_url',
  'unsupported_file_type',
  'answer_in_progress',
  'conversation_full',
  'bot_unavailable',
  'message_too_long',
  'handoff_disabled',
  'invalid_transition',
  'already_assigned',
  'stale_conversation',
  'origin_not_allowed',
  'bot_not_found',
  'challenge_required',
  'challenge_invalid',
  'challenge_not_configured',
  'not_found',
  'unauthorized',
  'forbidden',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_DETAILS_SCHEMA = z.object({
  path: z.string(),
  message: z.string(),
});

export type ErrorDetail = z.infer<typeof ERROR_DETAILS_SCHEMA>;

/** The body of every error response; `requestId` matches the `X-Request-Id` header. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.array(ERROR_DETAILS_SCHEMA).optional(),
    requestId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
