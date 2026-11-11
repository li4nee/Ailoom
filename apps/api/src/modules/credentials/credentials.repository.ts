// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderKind } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { ProviderCredentialEntity } from './provider-credential.entity';

/**
 * Credentials of one workspace. Every method is workspace-scoped through `TenantRepository`.
 *
 * The two bot queries are raw SQL: `bots` belongs to another module that imports this one for
 * the credential entity, so reading it through an entity import here would close a cycle.
 */
@Injectable()
export class CredentialsRepository extends TenantRepository<ProviderCredentialEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(ProviderCredentialEntity));
  }

  /** Oldest first, so a new credential appears at the end of the admin list. */
  async listAll(workspaceId: WorkspaceId): Promise<ProviderCredentialEntity[]> {
    return this.ds
      .getRepository(ProviderCredentialEntity)
      .find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
  }

  /** The workspace's built-in credential of `provider` (today only `local`, Task 2.6). */
  async findByProvider(
    workspaceId: WorkspaceId,
    provider: ProviderKind,
  ): Promise<ProviderCredentialEntity | null> {
    return this.ds
      .getRepository(ProviderCredentialEntity)
      .findOne({ where: { workspaceId, provider } });
  }

  /** Live (not soft-deleted) bots that use the credential for chat or embeddings. */
  async countLiveBotsUsing(workspaceId: WorkspaceId, credentialId: string): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count
         FROM bots
        WHERE workspace_id = $1
          AND deleted_at IS NULL
          AND (chat_credential_id = $2 OR embedding_credential_id = $2)`,
      [workspaceId, credentialId],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Removes the soft-deleted bots that still reference the credential. They are invisible
   * everywhere and only await their purge, but their foreign keys would block the delete that
   * spec §17.4 allows once no live bot uses the credential.
   */
  async deleteSoftDeletedBotsUsing(workspaceId: WorkspaceId, credentialId: string): Promise<void> {
    await this.ds.query(
      `DELETE FROM bots
        WHERE workspace_id = $1
          AND deleted_at IS NOT NULL
          AND (chat_credential_id = $2 OR embedding_credential_id = $2)`,
      [workspaceId, credentialId],
    );
  }
}
