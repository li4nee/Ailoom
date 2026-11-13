// SPDX-License-Identifier: AGPL-3.0-only
export { type DetectedFileType, detectFileType } from './detect-file-type';
export {
  assertSafeStorageKey,
  FILE_STORAGE,
  type FileStorage,
  newStorageKey,
  type StoredObject,
  workspaceOfKey,
} from './file-storage';
export { LocalDiskStorage } from './local-disk.storage';
export { MemoryStorage } from './memory.storage';
export { StorageModule, type StorageModuleOptions } from './storage.module';
