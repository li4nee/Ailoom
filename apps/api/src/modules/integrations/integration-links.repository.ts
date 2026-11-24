// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { IntegrationLinkEntity } from './integration-link.entity';

@Injectable()
export class IntegrationLinksRepository extends TenantRepository<IntegrationLinkEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(IntegrationLinkEntity));
  }

  /**
   * Records that a contact maps to a CRM object. A link is unique per idempotency key and per
   * CRM object, so a later event for an already-linked contact (an identity change or context
   * update) reuses the existing row instead of failing the delivery after the CRM write.
   */
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
    const executor = manager ?? this.ds.manager;
    // Raw SQL: TypeORM has no ON CONFLICT DO NOTHING across both unique indexes, and a caught
    // unique violation would abort a caller's transaction.
    await executor.query(
      `INSERT INTO contact_external_links
         (workspace_id, integration_id, contact_id, object_type, external_object_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        workspaceId,
        data.integrationId,
        data.contactId,
        data.objectType,
        data.externalObjectId,
        data.idempotencyKey,
      ],
    );
    const repository = executor.getRepository(IntegrationLinkEntity);
    const link = await repository.findOne({
      where: [
        { workspaceId, integrationId: data.integrationId, idempotencyKey: data.idempotencyKey },
        {
          workspaceId,
          integrationId: data.integrationId,
          objectType: data.objectType,
          externalObjectId: data.externalObjectId,
        },
      ],
    });
    if (link === null) throw new Error('integration link was not recorded');
    return link;
  }
}
