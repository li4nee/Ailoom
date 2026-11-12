// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import type { WorkspaceId } from '../../db/ids';
import type { ChunkDraft } from './domain/chunker';

export interface ChunkRow extends ChunkDraft {
  embedding: number[];
}

/**
 * Chunk rows with their vectors. Raw SQL because pgvector has no TypeORM driver: the vector is
 * sent as a `[1,2,3]` literal cast to `vector`, and chunk inserts are a single multi-row
 * statement so a batch of 64 is one round trip.
 */
@Injectable()
export class ChunksRepository {
  constructor(private readonly ds: DataSource) {}

  /** Existing ordinals for one version and model: a retried job resumes instead of duplicating. */
  async countForVersion(
    workspaceId: WorkspaceId,
    documentVersionId: string,
    embeddingModel: string,
    manager?: EntityManager,
  ): Promise<number> {
    const runner = manager ?? this.ds.manager;
    const rows = await runner.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM chunks
        WHERE workspace_id = $1 AND document_version_id = $2 AND embedding_model = $3`,
      [workspaceId, documentVersionId, embeddingModel],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Inserts rows for one model. `ON CONFLICT DO NOTHING` on the unique
   * `(document_version_id, embedding_model, ordinal)` index makes a repeated embedding pass
   * harmless (Task 3.7 idempotency test).
   */
  async insertMany(
    manager: EntityManager,
    input: {
      workspaceId: WorkspaceId;
      botId: string;
      documentVersionId: string;
      embeddingModel: string;
      embeddingDim: number;
      rows: ChunkRow[];
    },
  ): Promise<void> {
    if (input.rows.length === 0) return;
    const values: unknown[] = [];
    const tuples = input.rows.map((row, index) => {
      const base = index * 11;
      values.push(
        input.workspaceId,
        input.botId,
        input.documentVersionId,
        row.ordinal,
        row.headingPath,
        row.content,
        JSON.stringify(row.metadata),
        row.tokenCount,
        `[${row.embedding.join(',')}]`,
        input.embeddingModel,
        input.embeddingDim,
      );
      const holes = Array.from({ length: 11 }, (_, offset) => `$${String(base + offset + 1)}`) as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const [ws, bot, version, ordinal, heading, content, metadata, tokens, vector, model, dim] =
        holes;
      return `(${ws}, ${bot}, ${version}, ${ordinal}, ${heading}, ${content}, ${metadata}::jsonb, ${tokens}, ${vector}::vector, ${model}, ${dim})`;
    });
    await manager.query(
      `INSERT INTO chunks (workspace_id, bot_id, document_version_id, ordinal, heading_path,
                           content, metadata, token_count, embedding, embedding_model,
                           embedding_dim)
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING`,
      values,
    );
  }

  /** Chunks of versions of this document that are no longer current (spec §12.2). */
  async deleteForOldVersions(
    manager: EntityManager,
    workspaceId: WorkspaceId,
    documentId: string,
    keepVersionId: string,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM chunks
        WHERE workspace_id = $1
          AND document_version_id IN (
            SELECT id FROM document_versions
             WHERE workspace_id = $1 AND document_id = $2 AND id <> $3
          )`,
      [workspaceId, documentId, keepVersionId],
    );
  }

  /** The viewer's chunks of one version, without the vectors (they are never sent). */
  async listForVersion(
    workspaceId: WorkspaceId,
    documentVersionId: string,
  ): Promise<
    {
      ordinal: number;
      headingPath: string;
      content: string;
      tokenCount: number;
      metadata: Record<string, unknown>;
    }[]
  > {
    return this.ds.query(
      `SELECT ordinal, heading_path AS "headingPath", content, token_count AS "tokenCount",
              metadata
         FROM chunks
        WHERE workspace_id = $1 AND document_version_id = $2
        ORDER BY ordinal ASC`,
      [workspaceId, documentVersionId],
    );
  }

  async countForBot(workspaceId: WorkspaceId, botId: string): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM chunks WHERE workspace_id = $1 AND bot_id = $2`,
      [workspaceId, botId],
    );
    return rows[0]?.count ?? 0;
  }
}
