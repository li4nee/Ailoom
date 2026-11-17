// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { Clock } from '../../common/clock';
import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { ContactEntity } from './entities/contact.entity';

/** Visitors of one workspace. */
@Injectable()
export class ContactsRepository extends TenantRepository<ContactEntity> {
  constructor(
    private readonly ds: DataSource,
    private readonly clock: Clock,
  ) {
    super(ds.getRepository(ContactEntity));
  }

  /** Records that the contact was seen, on the caller's transaction. */
  async touch(workspaceId: WorkspaceId, id: string, manager: EntityManager): Promise<void> {
    await this.updateById(workspaceId, id, { lastSeenAt: this.clock.now() }, manager);
  }

  async findByExternalId(
    workspaceId: WorkspaceId,
    externalId: string,
    manager?: EntityManager,
  ): Promise<ContactEntity | null> {
    const repository =
      manager?.getRepository(ContactEntity) ?? this.ds.getRepository(ContactEntity);
    return repository.findOne({ where: { workspaceId, externalId } });
  }
}
