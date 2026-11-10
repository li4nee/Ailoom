// SPDX-License-Identifier: AGPL-3.0-only
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AppConfig } from '../common/config';
import { buildDataSourceOptions } from './data-source';

const OWNS_DATA_SOURCE = Symbol('OWNS_DATA_SOURCE');

/** Closes the pool on shutdown, unless the data source was handed in by the caller. */
@Injectable()
class DataSourceLifecycle implements OnApplicationShutdown {
  constructor(
    private readonly ds: DataSource,
    @Inject(OWNS_DATA_SOURCE) private readonly owned: boolean,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.owned && this.ds.isInitialized) await this.ds.destroy();
  }
}

/** Provides the initialized TypeORM `DataSource` globally (inject it by its class). */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class DatabaseModule {
  /**
   * Opens a pool from `config.database`, or uses `existing` as is: the test harness shares
   * one migrated data source between the app and the test, and closes it itself.
   */
  static forRoot(config: AppConfig, existing?: DataSource): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        existing === undefined
          ? {
              provide: DataSource,
              useFactory: () =>
                new DataSource(buildDataSourceOptions(config.database)).initialize(),
            }
          : { provide: DataSource, useValue: existing },
        { provide: OWNS_DATA_SOURCE, useValue: existing === undefined },
        DataSourceLifecycle,
      ],
      exports: [DataSource],
    };
  }
}
