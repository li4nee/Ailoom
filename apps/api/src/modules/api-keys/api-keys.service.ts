// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ApiKeyDto, CreatedApiKey, CreateApiKeyRequest } from '@app/shared';

import { Clock } from '../../common/clock';
import { randomToken, sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asWorkspaceId, type UserId, type WorkspaceId } from '../../db/ids';
import { ApiKeyEntity } from './api-key.entity';
import { toApiKeyDto } from './api-keys.mapper';
import { ApiKeysRepository } from './api-keys.repository';

const TOKEN_PREFIX = 'ak_live_';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly ds: DataSource,
    private readonly keys: ApiKeysRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    private readonly clock: Clock,
  ) {}

  async list(workspaceId: WorkspaceId): Promise<ApiKeyDto[]> {
    return (await this.keys.listForWorkspace(workspaceId)).map(toApiKeyDto);
  }

  async create(
    workspaceId: WorkspaceId,
    actorUserId: UserId,
    input: CreateApiKeyRequest,
  ): Promise<CreatedApiKey> {
    const expiresAt = this.parseExpiry(input.expiresAt);
    const rawToken = `${TOKEN_PREFIX}${randomToken(32)}`;
    const row = await this.ds.transaction(async (manager) => {
      const created = await this.keys.insertKey(
        workspaceId,
        {
          name: input.name,
          keyHash: sha256Hex(rawToken),
          keyPrefix: rawToken.slice(0, 16),
          scopes: [...new Set(input.scopes)],
          createdByUserId: actorUserId,
          expiresAt,
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'api_key.created',
          targetType: 'api_key',
          targetId: created.id,
          metadata: { name: created.name, scopes: created.scopes },
        },
        manager,
      );
      return created;
    });
    return { key: toApiKeyDto(row), token: rawToken };
  }

  async revoke(workspaceId: WorkspaceId, actorUserId: UserId, keyId: string): Promise<void> {
    const now = this.clock.now();
    const key = await this.keys.getById(workspaceId, keyId);
    if (key.revokedAt !== null) return;
    await this.ds.transaction(async (manager) => {
      await this.keys.updateById(workspaceId, key.id, { revokedAt: now }, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'api_key.revoked',
          targetType: 'api_key',
          targetId: key.id,
          metadata: {},
        },
        manager,
      );
    });
  }

  async rotate(
    workspaceId: WorkspaceId,
    actorUserId: UserId,
    keyId: string,
  ): Promise<CreatedApiKey> {
    const old = await this.keys.getById(workspaceId, keyId);
    if (old.revokedAt !== null) throw new AppError('conflict');
    if (old.expiresAt !== null && old.expiresAt <= this.clock.now()) {
      throw new AppError('conflict', { message: 'An expired API key cannot be rotated.' });
    }
    const rawToken = `${TOKEN_PREFIX}${randomToken(32)}`;
    const row = await this.ds.transaction(async (manager) => {
      await this.keys.updateById(workspaceId, old.id, { revokedAt: this.clock.now() }, manager);
      const created = await this.keys.insertKey(
        workspaceId,
        {
          name: old.name,
          keyHash: sha256Hex(rawToken),
          keyPrefix: rawToken.slice(0, 16),
          scopes: old.scopes,
          createdByUserId: actorUserId,
          expiresAt: old.expiresAt,
        },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'api_key.rotated',
          targetType: 'api_key',
          targetId: created.id,
          metadata: { replacedKeyId: old.id },
        },
        manager,
      );
      return created;
    });
    return { key: toApiKeyDto(row), token: rawToken };
  }

  private parseExpiry(raw: string | undefined): Date | null {
    if (raw === undefined) return null;
    const expiresAt = new Date(raw);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= this.clock.now()) {
      throw new AppError('validation_failed', {
        details: [{ path: 'expiresAt', message: 'Expiration must be a future date.' }],
      });
    }
    return expiresAt;
  }

  /** Auth guard entrypoint; never returns revoked or expired credentials. */
  authenticate(workspaceId: string, rawToken: string): Promise<ApiKeyEntity | null> {
    return this.keys.findActiveByHash(
      asWorkspaceId(workspaceId),
      sha256Hex(rawToken),
      this.clock.now(),
    );
  }
}
