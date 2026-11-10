// SPDX-License-Identifier: AGPL-3.0-only
import type { MemberDto, WorkspaceDto, WorkspaceSettings, WorkspaceSummaryDto } from '@app/shared';

import type { WorkspaceEntity } from './entities/workspace.entity';
import type { MembershipRow } from './memberships.repository';
import type { WorkspaceSummaryRow } from './workspaces.repository';

/** The API only exposes known settings keys; anything else in the jsonb stays internal. */
function toSettings(raw: Record<string, unknown>): WorkspaceSettings {
  const emails = raw['notificationEmails'];
  return {
    notificationEmails: Array.isArray(emails)
      ? emails.filter((email): email is string => typeof email === 'string')
      : [],
  };
}

export function toWorkspaceDto(workspace: WorkspaceEntity): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    settings: toSettings(workspace.settings),
  };
}

export function toWorkspaceSummaryDto(row: WorkspaceSummaryRow): WorkspaceSummaryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    settings: toSettings(row.settings),
    role: row.role,
  };
}

export function toMemberDto(row: MembershipRow): MemberDto {
  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    joinedAt: row.createdAt.toISOString(),
  };
}
