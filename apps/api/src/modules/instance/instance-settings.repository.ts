// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource, type QueryDeepPartialEntity } from 'typeorm';

import { InstanceSettingEntity } from './entities/instance-setting.entity';

/** `instance_settings` is a single-instance key/value store, not tenant data. */
@Injectable()
export class InstanceSettingsRepository {
  constructor(private readonly ds: DataSource) {}

  async find(key: string): Promise<InstanceSettingEntity | null> {
    return this.ds.getRepository(InstanceSettingEntity).findOneBy({ key });
  }

  /** Creates or replaces the row. `upsert` skips `@UpdateDateColumn`, so the time is passed in. */
  async set(key: string, value: unknown, updatedBy: string | null, updatedAt: Date): Promise<void> {
    // JSONB is typed `unknown` by TypeORM, so the row needs the query builder's row type.
    const row = {
      key,
      value,
      updatedBy,
      updatedAt,
    } as QueryDeepPartialEntity<InstanceSettingEntity>;
    await this.ds.getRepository(InstanceSettingEntity).upsert(row, ['key']);
  }
}
