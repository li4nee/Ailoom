// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module } from '@nestjs/common';

import type { AppConfig } from '../config';
import { FILE_STORAGE, type FileStorage } from './file-storage';
import { LocalDiskStorage } from './local-disk.storage';

export interface StorageModuleOptions {
  /** Test seam: a memory-backed store instead of `STORAGE_DIR`. */
  storage?: FileStorage;
}

/**
 * Global: the knowledge module writes uploads through `FILE_STORAGE`, and the worker deletes
 * them during a purge; neither should have to import a storage module of its own.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class StorageModule {
  static forRoot(config: AppConfig, options: StorageModuleOptions = {}): DynamicModule {
    const storage = options.storage ?? new LocalDiskStorage(config.storageDir);
    return {
      module: StorageModule,
      global: true,
      providers: [{ provide: FILE_STORAGE, useValue: storage }],
      exports: [FILE_STORAGE],
    };
  }
}
