// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { Role } from '@app/shared';

import type { UserId, WorkspaceId } from '../../db/ids';

export interface AccessInfo {
  tokenVersion: number;
  isInstanceAdmin: boolean;
  emailVerified: boolean;
  role: Role | null;
}

interface AccessRow {
  token_version: number;
  is_instance_admin: boolean;
  email_verified: boolean;
  role: Role | null;
}

/**
 * Raw SQL: the guard must answer "is this user still allowed here?" with exactly one query
 * (ADR-007). A deleted workspace yields no row in the join, so its members get the same
 * answer as non-members and never learn the workspace still exists.
 */
const ACCESS_SQL = `
  SELECT u.token_version,
         u.is_instance_admin,
         u.email_verified_at IS NOT NULL AS email_verified,
         CASE WHEN w.id IS NULL THEN NULL ELSE m.role END AS role
    FROM users u
    LEFT JOIN memberships m
           ON m.user_id = u.id
          AND m.workspace_id = $2
    LEFT JOIN workspaces w
           ON w.id = m.workspace_id
          AND w.deleted_at IS NULL
   WHERE u.id = $1
`;

@Injectable()
export class AccessRepository {
  constructor(private readonly ds: DataSource) {}

  /** Null when the user does not exist; role stays null outside a workspace or without membership. */
  async load(userId: UserId, workspaceId: WorkspaceId | null): Promise<AccessInfo | null> {
    const rows = await this.ds.query<AccessRow[]>(ACCESS_SQL, [userId, workspaceId]);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      tokenVersion: row.token_version,
      isInstanceAdmin: row.is_instance_admin,
      emailVerified: row.email_verified,
      role: row.role,
    };
  }
}
