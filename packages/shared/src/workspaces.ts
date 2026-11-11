// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { emailSchema } from './auth.js';
import { INVITATION_ROLES, ROLES } from './enums.js';

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

/** `settings` is deep-merged, so omitted keys keep their stored values. */
export const updateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  settings: z
    .object({
      notificationEmails: z.array(emailSchema).max(20).optional(),
    })
    .optional(),
});

/** The settings the workspace API exposes; unknown stored keys stay internal. */
export const workspaceSettingsSchema = z.object({
  notificationEmails: z.array(z.string()),
});

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  settings: workspaceSettingsSchema,
});

/** One row of `GET /api/v1/workspaces`: the workspace plus my role in it. */
export const workspaceSummarySchema = workspaceSchema.extend({ role: z.enum(ROLES) });

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(ROLES),
  joinedAt: z.string(),
});

/** Ownership is never granted by invitation or role change; it moves only by transfer. */
export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(INVITATION_ROLES),
});

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(INVITATION_ROLES),
  invitedBy: z.string(),
  expiresAt: z.string(),
});

/**
 * `acceptUrl` is set only when the instance has no email transport, so the admin can share it
 * by hand. With email, the link travels only by email, which keeps the token a proof that the
 * invitee controls the inbox. The token is stored hashed and never listed.
 */
export const createdInvitationSchema = invitationSchema.extend({
  acceptUrl: z.string().nullable(),
});

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(1).max(200),
});

/** What the invite page shows before the user signs in; the token itself is the credential. */
export const invitationPreviewSchema = z.object({
  workspaceName: z.string(),
  role: z.enum(INVITATION_ROLES),
  email: z.string(),
});

export const invitationPreviewQuerySchema = z.object({ token: z.string().min(1).max(200) });

export const acceptInvitationResponseSchema = z.object({
  workspaceId: z.string(),
  role: z.enum(INVITATION_ROLES),
});

export const updateMemberRequestSchema = z.object({
  role: z.enum(INVITATION_ROLES),
});

export const transferOwnershipRequestSchema = z.object({
  userId: z.uuid(),
});

export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;
export type WorkspaceDto = z.infer<typeof workspaceSchema>;
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export type WorkspaceSummaryDto = z.infer<typeof workspaceSummarySchema>;
export type MemberDto = z.infer<typeof memberSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type InvitationDto = z.infer<typeof invitationSchema>;
export type CreatedInvitationDto = z.infer<typeof createdInvitationSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequestSchema>;
