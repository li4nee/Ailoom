// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { BotId, WorkspaceId } from '../../db/ids';

/** Dimensions with a partial HNSW index (spec §12.6); 3072 uses `halfvec`. */
export const INDEXED_DIMENSIONS = [384, 768, 1024, 1536, 3072] as const;

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  title: string;
  url: string | null;
  headingPath: string;
  content: string;
  metadata: { pages?: number[] };
  score: number;
  /** 1-based position in the candidate list. */
  rank: number;
}

interface Row {
  chunk_id: string;
  document_id: string;
  title: string;
  url: string | null;
  heading_path: string;
  content: string;
  metadata: { pages?: number[] };
  distance: number;
}

export interface SearchInput {
  botId: BotId;
  embeddingModel: string;
  dim: number;
  vector: number[];
  limit: number;
}

/**
 * Spec §13.1. The HNSW index is shared by every bot of a dimension, so without iterative
 * scanning a small bot on a busy instance would get fewer than `limit` rows: the scan keeps
 * going (`relaxed_order`) until enough rows pass the bot/model filters, and the outer ORDER BY
 * restores exact distance order. The casts mirror the per-dimension index definitions so the
 * planner can use one; dimensions without an index fall back to an exact scan.
 */
@Injectable()
export class RetrievalRepository {
  constructor(private readonly ds: DataSource) {}

  async search(workspaceId: WorkspaceId, query: SearchInput): Promise<RetrievedChunk[]> {
    const cast = this.cast(query.dim);
    return this.ds.transaction(async (manager) => {
      await manager.query('SET LOCAL hnsw.ef_search = 64');
      await manager.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
      await manager.query('SET LOCAL hnsw.max_scan_tuples = 20000');
      const rows = await manager.query<Row[]>(
        `WITH candidates AS (
           SELECT c.id AS chunk_id, d.id AS document_id, d.title, d.url,
                  c.heading_path, c.content, c.metadata,
                  c.embedding${cast} <=> $4${cast} AS distance
             FROM chunks c
             JOIN documents d ON d.current_version_id = c.document_version_id
            WHERE c.workspace_id = $1
              AND c.bot_id = $2
              AND c.embedding_dim = $3
              AND c.embedding_model = $5
            ORDER BY distance
            LIMIT $6
         )
         SELECT chunk_id, document_id, title, url, heading_path, content, metadata, distance,
                1 - distance AS score
           FROM candidates
          ORDER BY distance`,
        [
          workspaceId,
          query.botId,
          query.dim,
          `[${query.vector.join(',')}]`,
          query.embeddingModel,
          query.limit,
        ],
      );
      return rows.map((row, index) => ({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        title: row.title,
        url: row.url,
        headingPath: row.heading_path,
        content: row.content,
        metadata: row.metadata,
        score: 1 - row.distance,
        rank: index + 1,
      }));
    });
  }

  /** Chunks of the current version for one model: what retrieval can actually reach. */
  async countReadyChunks(
    workspaceId: WorkspaceId,
    botId: BotId,
    embeddingModel: string,
  ): Promise<number> {
    const rows = await this.ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count
         FROM chunks c
         JOIN documents d ON d.current_version_id = c.document_version_id
        WHERE c.workspace_id = $1 AND c.bot_id = $2 AND c.embedding_model = $3`,
      [workspaceId, botId, embeddingModel],
    );
    return rows[0]?.count ?? 0;
  }

  /** The provider of a credential, for pricing an embedding call. */
  async providerOf(credentialId: string): Promise<string | null> {
    const rows = await this.ds.query<{ provider: string }[]>(
      `SELECT provider FROM provider_credentials WHERE id = $1`,
      [credentialId],
    );
    return rows[0]?.provider ?? null;
  }

  private cast(dim: number): string {
    if (!(INDEXED_DIMENSIONS as readonly number[]).includes(dim)) return '';
    return dim === 3072 ? '::halfvec(3072)' : `::vector(${String(dim)})`;
  }
}
