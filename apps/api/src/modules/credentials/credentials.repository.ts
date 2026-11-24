// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

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
    manager?: EntityManager,
  ): Promise<ProviderCredentialEntity | null> {
    return (manager ?? this.ds)
      .getRepository(ProviderCredentialEntity)
      .findOne({ where: { workspaceId, provider } });
  }

  /**
   * Takes the row lock a credential delete needs. A bot insert that references the credential
   * takes `FOR KEY SHARE` on it, which conflicts with this lock, so no bot can start using the
   * credential between the in-use count and the delete.
   */
  async lockForDelete(
    workspaceId: WorkspaceId,
    credentialId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `SELECT id FROM provider_credentials WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, credentialId],
    );
  }

  /** Live (not soft-deleted) bots that use the credential for chat or embeddings. */
  async countLiveBotsUsing(
    workspaceId: WorkspaceId,
    credentialId: string,
    manager: EntityManager,
  ): Promise<number> {
    const rows = await manager.query<{ count: number }[]>(
      `SELECT count(*)::int AS count
         FROM bots
        WHERE workspace_id = $1
          AND deleted_at IS NULL
          AND (chat_credential_id = $2 OR embedding_credential_id = $2 OR fallback_chat_credential_id = $2)`,
      [workspaceId, credentialId],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Every secret sealed with an older master key, oldest first, at most `limit` per call.
   *
   * Raw SQL, and deliberately not workspace-scoped: master-key rotation is instance-wide
   * maintenance, while every `TenantRepository` read requires a workspace id by design.
   * Keyless rows (e.g. Ollama) have no secret to rotate and are skipped. So are malformed rows
   * (ciphertext without iv, tag or key version): they cannot be opened, and returning them would
   * hand the caller the same unrotatable batch forever.
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
          AND secret_iv IS NOT NULL
          AND secret_tag IS NOT NULL
          AND key_version IS NOT NULL
          AND key_version <> $1
        ORDER BY created_at, id
        LIMIT $2`,
      [activeKeyVersion, limit],
    );
  }

  /**
   * Rewrites one row's secret with the active key (also instance-wide, see `listStale`), but only
   * if the row still holds `previous`: an admin who saved a new key after the row was read wins,
   * and the stale re-encryption is dropped. Returns whether the row was rewritten.
   */
  async reseal(id: string, previous: Sealed, sealed: Sealed): Promise<boolean> {
    // For an UPDATE, TypeORM's Postgres driver answers `[returnedRows, affectedCount]`.
    const [, affected] = await this.ds.query<[unknown[], number]>(
      `UPDATE provider_credentials
          SET secret_ciphertext = $2, secret_iv = $3, secret_tag = $4, key_version = $5,
              updated_at = now()
        WHERE id = $1 AND secret_ciphertext = $6 AND key_version = $7`,
      [
        id,
        sealed.ciphertext,
        sealed.iv,
        sealed.tag,
        sealed.keyVersion,
        previous.ciphertext,
        previous.keyVersion,
      ],
    );
    return affected > 0;
  }

  /**
   * Call outcomes are written in raw SQL so `updated_at` stays put: that column means
   * "configuration changed", and the provider registry keys its cached clients on it (an entity
   * update would bump it through `@UpdateDateColumn`).
   *
   * A success clears the last error, so a fixed credential stops reporting the old failure.
   */
  async recordSuccess(workspaceId: WorkspaceId, id: string, at: Date): Promise<void> {
    await this.ds.query(
      `UPDATE provider_credentials
          SET last_used_at = $3, last_error = NULL, last_error_at = NULL
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, at],
    );
  }

  async recordError(workspaceId: WorkspaceId, id: string, code: string, at: Date): Promise<void> {
    await this.ds.query(
      `UPDATE provider_credentials
          SET last_error = $3, last_error_at = $4
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, code, at],
    );
  }

  /**
   * Removes the soft-deleted bots that still reference the credential. They are invisible
   * everywhere and only await their purge, but their foreign keys would block the delete that
   * spec §17.4 allows once no live bot uses the credential.
   */
  async deleteSoftDeletedBotsUsing(
    workspaceId: WorkspaceId,
    credentialId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM bots
        WHERE workspace_id = $1
          AND deleted_at IS NOT NULL
          AND (chat_credential_id = $2 OR embedding_credential_id = $2 OR fallback_chat_credential_id = $2)`,
      [workspaceId, credentialId],
    );
  }
}
