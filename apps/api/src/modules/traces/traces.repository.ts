// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import { TenantRepository } from '../../db/tenant.repository';
import { GenerationTraceEntity } from './generation-trace.entity';

/** One row per answer attempt (spec §9.5); written by `ChatPersistence.finalize`. */
@Injectable()
export class TracesRepository extends TenantRepository<GenerationTraceEntity> {
  constructor(private readonly ds: DataSource) {
    super(ds.getRepository(GenerationTraceEntity));
  }

  /** The trace of one AI message, or null for a message that never got one. */
  async findByMessageId(
    workspaceId: WorkspaceId,
    messageId: string,
    manager?: EntityManager,
  ): Promise<GenerationTraceEntity | null> {
    return this.repositoryFor(manager).findOne({ where: { workspaceId, messageId } });
  }

  private repositoryFor(manager?: EntityManager): Repository<GenerationTraceEntity> {
    return manager === undefined
      ? this.ds.getRepository(GenerationTraceEntity)
      : manager.getRepository(GenerationTraceEntity);
  }
}
