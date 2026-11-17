// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { ApiKeyScope } from '@app/shared';

import type { UserId, WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { ApiKeyEntity } from './api-key.entity';

@Injectable()
export class ApiKeysRepository extends TenantRepository<ApiKeyEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(ApiKeyEntity));
  }

  async listForWorkspace(workspaceId: WorkspaceId): Promise<ApiKeyEntity[]> {
    return this.ds.getRepository(ApiKeyEntity).find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async findActiveByHash(
    workspaceId: WorkspaceId,
    keyHash: string,
    now: Date,
  ): Promise<ApiKeyEntity | null> {
    const repository = this.ds.getRepository(ApiKeyEntity);
    const key = await repository.findOne({ where: { workspaceId, keyHash } });
    if (key === null) return null;
    if (
      key.revokedAt !== null ||
      (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime())
    )
      return null;
    await repository.update({ id: key.id, workspaceId }, { lastUsedAt: now });
    key.lastUsedAt = now;
    return key;
  }

  async insertKey(
    workspaceId: WorkspaceId,
    data: {
      name: string;
      keyHash: string;
      keyPrefix: string;
      scopes: ApiKeyScope[];
      createdByUserId: UserId;
      expiresAt: Date | null;
    },
    manager?: EntityManager,
  ): Promise<ApiKeyEntity> {
    return this.insert(workspaceId, data, manager);
  }
}
