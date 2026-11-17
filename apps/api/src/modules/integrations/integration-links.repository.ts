// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { ContactId, WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { IntegrationLinkEntity } from './integration-link.entity';

@Injectable()
export class IntegrationLinksRepository extends TenantRepository<IntegrationLinkEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(IntegrationLinkEntity));
  }

  async upsert(
    workspaceId: WorkspaceId,
    data: {
      integrationId: string;
      contactId: string;
      objectType: string;
      externalObjectId: string;
      idempotencyKey: string;
    },
    manager?: EntityManager,
  ): Promise<IntegrationLinkEntity> {
    const repository = (manager ?? this.ds).getRepository(IntegrationLinkEntity);
    const existing = await repository.findOne({
      where: {
        workspaceId,
        integrationId: data.integrationId,
        idempotencyKey: data.idempotencyKey,
      },
    });
    if (existing !== null) return existing;
    return this.insert(workspaceId, { ...data, contactId: data.contactId as ContactId }, manager);
  }
}
