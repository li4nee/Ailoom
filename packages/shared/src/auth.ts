// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { ROLES } from './enums.js';

/** OWASP-aligned password length bounds (spec §10.1). */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/**
 * An email address as clients send it. Whitespace is trimmed; case is preserved for
 * display, matching happens case-insensitively (citext) in the database.
 */
export const emailSchema = z.string().trim().max(254).pipe(z.email());

/** Length rules only. The common-password and email-content checks run server-side. */
export const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const signupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(100).optional(),
  invitationToken: z.string().min(1).max(200).optional(),
});

/**
 * Login deliberately accepts any non-empty password: the policy governs password
 * *creation*, and an older account may still hold a password that no longer passes it.
 */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});

export const membershipSummarySchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  role: z.enum(ROLES),
});

/** `PATCH /api/v1/auth/me`: a name change, a password change, or both. */
export const updateMeRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    currentPassword: z.string().min(1).max(PASSWORD_MAX).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((value) => (value.newPassword === undefined) === (value.currentPassword === undefined), {
    message: 'currentPassword is required to set newPassword.',
    path: ['currentPassword'],
  });

/** `GET /api/v1/auth/me`. */
export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  emailVerified: z.boolean(),
  isInstanceAdmin: z.boolean(),
  memberships: z.array(membershipSummarySchema),
});

/** One row of `GET /api/v1/auth/sessions`. Timestamps are ISO 8601 strings. */
export const sessionSchema = z.object({
  sessionId: z.string(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  current: z.boolean(),
});

export type EmailField = z.infer<typeof emailSchema>;
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type SessionDto = z.infer<typeof sessionSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
