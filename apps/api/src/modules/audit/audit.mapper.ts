// SPDX-License-Identifier: AGPL-3.0-only
import type { AuditAction, AuditEntryDto } from '@app/shared';

import type { AuditLogEntity } from './audit-log.entity';

export function toAuditEntryDto(row: AuditLogEntity): AuditEntryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId,
    // The column is plain text so later milestones can append actions without a migration.
    action: row.action as AuditAction,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}
