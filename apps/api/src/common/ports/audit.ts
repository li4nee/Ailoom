// SPDX-License-Identifier: AGPL-3.0-only
import type { EntityManager } from 'typeorm';

import type { AuditAction } from '@app/shared';

export interface AuditEntryInput {
  workspaceId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * The write side of the audit log, injected by feature modules. The token lives in `common`
 * so a module can record without importing the audit module (whose entity imports the
 * workspace/auth barrels, which would close a module cycle).
 */
export interface AuditWriter {
  record(entry: AuditEntryInput, manager?: EntityManager): Promise<void>;
}

export const AUDIT_LOG = Symbol('AUDIT_LOG');
