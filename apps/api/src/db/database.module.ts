// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable @typescript-eslint/no-extraneous-class */
import { Module, Global, DynamicModule } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';

import { type AppConfig } from '../common/config';
import { buildDataSourceOptions } from './data-source';

export const DATA_SOURCE = Symbol('DATA_SOURCE');

/** Lazy DataSource that initializes on first use. */
class LazyDataSource {
  private ds: DataSource | null = null;
  private initPromise: Promise<DataSource> | null = null;

  constructor(private readonly options: DataSourceOptions) {}

  async get(): Promise<DataSource> {
    if (this.ds) return this.ds;
    this.initPromise ??= (async () => {
      const ds = new DataSource(this.options);
      await ds.initialize();
      this.ds = ds;
      return ds;
    })();
    return this.initPromise;
  }

  /** For compatibility with code that expects a DataSource instance. */
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    const ds = await this.get();
    return ds.query(sql, params);
  }

  async showMigrations(): Promise<string[]> {
    const ds = await this.get();
    return ds.showMigrations();
  }

  // Delegate other methods as needed
  get isInitialized(): boolean {
    return this.ds?.isInitialized ?? false;
  }

  async destroy(): Promise<void> {
    if (this.ds) {
      await this.ds.destroy();
      this.ds = null;
      this.initPromise = null;
    }
  }
}

/** Provides a lazily-initialized TypeORM DataSource. */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(config: AppConfig): DynamicModule {
    const options = buildDataSourceOptions(config.database);
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DATA_SOURCE,
          useFactory: () => new LazyDataSource(options),
        },
      ],
      exports: [DATA_SOURCE],
    };
  }

  static forTest(ds: DataSource): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DATA_SOURCE,
          useValue: ds,
        },
      ],
      exports: [DATA_SOURCE],
    };
  }
}
