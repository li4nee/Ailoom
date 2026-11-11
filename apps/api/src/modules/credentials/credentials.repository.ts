// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderKind } from '@app/shared';

import type { Sealed } from '../../common/crypto';
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
  /**
   * Every secret sealed with an older master key, oldest first, at most `limit` per call.
   *
   * Raw SQL, and deliberately not workspace-scoped: master-key rotation is instance-wide
   * maintenance, while every `TenantRepository` read requires a workspace id by design.
   * Keyless rows (NULL key_version, e.g. Ollama) have no secret to rotate and are skipped.
   */
  async listStale(activeKeyVersion: number, limit: number): Promise<ProviderCredentialEntity[]> {
    return this.ds.query<ProviderCredentialEntity[]>(
      `SELECT id, workspace_id AS "workspaceId", provider, label,
              secret_ciphertext AS "secretCiphertext", secret_iv AS "secretIv",
              secret_tag AS "secretTag", key_version AS "keyVersion",
              secret_last4 AS "secretLast4", base_url AS "baseUrl",
              last_used_at AS "lastUsedAt", last_error_at AS "lastErrorAt",
              last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM provider_credentials
        WHERE secret_ciphertext IS NOT NULL
          AND key_version IS DISTINCT FROM $1
        ORDER BY created_at, id
        LIMIT $2`,
      [activeKeyVersion, limit],
    );
  }

  /** Rewrites one row's secret with the active key (also instance-wide, see `listStale`). */
  async reseal(id: string, sealed: Sealed): Promise<void> {
    await this.ds.query(
      `UPDATE provider_credentials
          SET secret_ciphertext = $2, secret_iv = $3, secret_tag = $4, key_version = $5,
              updated_at = now()
        WHERE id = $1`,
      [id, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion],
    );
  }

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
