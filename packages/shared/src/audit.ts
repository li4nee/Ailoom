// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** Every audited action. Later milestones append to this list (the column is plain text). */
export const AUDIT_ACTIONS = [
  'member.invited',
  'member.invitation_revoked',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'workspace.created',
  'workspace.updated',
  'workspace.ownership_transferred',
  'workspace.deleted',
  'instance.signup_mode_changed',
  'credential.created',
  'credential.updated',
  'credential.deleted',
  'bot.created',
  'bot.updated',
  'bot.key_rotated',
  'bot.prompt_updated',
  'bot.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One row of `GET /api/v1/workspaces/:workspaceId/audit-log`. */
export const auditEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  action: z.enum(AUDIT_ACTIONS),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

export type AuditEntryDto = z.infer<typeof auditEntrySchema>;
