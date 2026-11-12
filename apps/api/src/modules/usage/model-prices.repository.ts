// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import type { ModelPrice } from '@app/shared';

import type { WorkspaceId } from '../../db/ids';
import { ModelPriceEntity } from './model-price.entity';

/**
 * The workspace's price overrides. Not a `TenantRepository`: `model_prices` also holds the
 * built-in rows (`workspace_id` NULL), so the entity cannot be a `TenantEntity`, and every
 * query here adds the workspace predicate itself.
 *
 * Built-ins are never read from the table: `providers/data/prices.json` is the shipped table,
 * and the database only ever holds what an operator overrode.
 */
@Injectable()
export class ModelPricesRepository {
  constructor(private readonly ds: DataSource) {}

  async listOverrides(workspaceId: WorkspaceId): Promise<ModelPriceEntity[]> {
    return this.repo().find({
      where: { workspaceId },
      order: { provider: 'ASC', model: 'ASC' },
    });
  }

  /** Swap the whole override set in one transaction: a failed insert leaves the old set. */
  async replaceOverrides(workspaceId: WorkspaceId, prices: ModelPrice[]): Promise<void> {
    await this.ds.transaction(async (manager: EntityManager) => {
      await manager.delete(ModelPriceEntity, { workspaceId });
      if (prices.length === 0) return;
      await manager.insert(
        ModelPriceEntity,
        prices.map((price) => ({ ...price, workspaceId })),
      );
    });
  }

  private repo() {
    return this.ds.getRepository(ModelPriceEntity);
  }
}
