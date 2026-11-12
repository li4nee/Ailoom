// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FILE_STORAGE, type FileStorage } from '../../common/storage';
import type { WorkspaceId } from '../../db/ids';
import { notifyWorkspace } from '../realtime';
import { DELETE_BATCH_SIZE, DeletionRepository } from './deletion.repository';
import { SourcesRepository } from './sources.repository';

/** Spec §12.8: chunks and versions go before the documents and source that own them. */
@Injectable()
export class DeletionService {
  constructor(
    private readonly ds: DataSource,
    private readonly deletion: DeletionRepository,
    private readonly sources: SourcesRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /** Hard-deletes one source and everything it indexed. Idempotent: a missing source is done. */
  async purgeSource(workspaceId: WorkspaceId, sourceId: string): Promise<boolean> {
    const source = await this.sources.findById(workspaceId, sourceId);
    if (source === null) return false;

    const fileId = typeof source.options['fileId'] === 'string' ? source.options['fileId'] : null;
    const keys = await this.deletion.storageKeysForSource(
      workspaceId,
      sourceId,
      fileId,
      source.fileKey,
    );
    for (const key of keys) await this.storage.delete(key);

    await this.drain((limit) => this.deletion.deleteChunksBatch(workspaceId, sourceId, limit));
    await this.drain((limit) => this.deletion.deleteVersionsBatch(workspaceId, sourceId, limit));
    await this.drain((limit) => this.deletion.deleteDocumentsBatch(workspaceId, sourceId, limit));
    await this.deletion.deleteFileRows(workspaceId, sourceId, fileId, source.fileKey);
    await this.deletion.deleteSource(workspaceId, sourceId);

    await this.ds.transaction(async (manager) => {
      await notifyWorkspace(manager, workspaceId, {
        type: 'source.updated',
        sourceId,
        botId: source.botId,
        status: 'deleted',
      });
    });
    return true;
  }

  /**
   * Every source a bot owns. The bot is soft-deleted, so its sources remain until this runs;
   * a source already gone is skipped, and a retry continues where the last attempt stopped.
   */
  async purgeBot(workspaceId: WorkspaceId, botId: string): Promise<void> {
    for (;;) {
      const ids = await this.deletion.listSourceIdsForBot(workspaceId, botId, 100);
      if (ids.length === 0) return;
      for (const id of ids) await this.purgeSource(workspaceId, id);
    }
  }

  private async drain(remove: (limit: number) => Promise<number>): Promise<void> {
    for (;;) {
      const deleted = await remove(DELETE_BATCH_SIZE);
      if (deleted < DELETE_BATCH_SIZE) return;
    }
  }
}
