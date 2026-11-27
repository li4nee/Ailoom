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
  vectorRank?: number | null;
  keywordRank?: number | null;
  fusionScore?: number;
  maxScore?: number;
  originalRank?: number;
  rerankScore?: number;
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
  queryText?: string;
}

function lexicalQuery(query: string): string | null {
  const terms = [
    ...new Set(
      query
        .normalize('NFKC')
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu) ?? [],
    ),
  ]
    .filter((term) => term.length > 1)
    .slice(0, 12);
  return terms.length === 0 ? null : terms.map((term) => `'${term}':*`).join(' | ');
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
      // Keep the HNSW settings transaction-local, but send them in one round trip. These are
      // fixed for every search and do not need three separate client/server exchanges.
      await manager.query(`
        SET LOCAL hnsw.ef_search = 64;
        SET LOCAL hnsw.iterative_scan = relaxed_order;
        SET LOCAL hnsw.max_scan_tuples = 20000;
      `);
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
            ORDER BY distance, c.id
            LIMIT $6
         )
         SELECT chunk_id, document_id, title, url, heading_path, content, metadata, distance,
                1 - distance AS score
           FROM candidates
          ORDER BY distance, chunk_id`,
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

  /** Vector + indexed PostgreSQL full-text candidates fused with reciprocal rank fusion. */
  async searchHybrid(
    workspaceId: WorkspaceId,
    query: SearchInput,
    threshold: number,
  ): Promise<RetrievedChunk[]> {
    const cast = this.cast(query.dim);
    const terms = lexicalQuery(query.queryText ?? '');
    if (terms === null) return this.search(workspaceId, query);
    return this.ds.transaction(async (manager) => {
      await manager.query(`
        SET LOCAL hnsw.ef_search = 64;
        SET LOCAL hnsw.iterative_scan = relaxed_order;
        SET LOCAL hnsw.max_scan_tuples = 20000;
      `);
      const rows = await manager.query<
        (Row & {
          vector_rank: number | null;
          keyword_rank: number | null;
          fusion_score: number;
          max_score: number;
        })[]
      >(
        `WITH vector_candidates AS (
         SELECT c.id AS chunk_id, d.id AS document_id, d.title, d.url,
                c.heading_path, c.content, c.metadata,
                c.embedding${cast} <=> $4${cast} AS distance,
                row_number() OVER (ORDER BY c.embedding${cast} <=> $4${cast}, c.id)::int AS vector_rank
           FROM chunks c
           JOIN documents d ON d.current_version_id = c.document_version_id
          WHERE c.workspace_id = $1 AND c.bot_id = $2
            AND c.embedding_dim = $3 AND c.embedding_model = $5
          ORDER BY c.embedding${cast} <=> $4${cast}, c.id
          LIMIT $6
       ), keyword_candidates AS (
         SELECT c.id AS chunk_id, d.id AS document_id, d.title, d.url,
                c.heading_path, c.content, c.metadata,
                c.embedding${cast} <=> $4${cast} AS distance,
                row_number() OVER (ORDER BY ts_rank(c.tsv, to_tsquery('simple', $7)) DESC, c.id)::int AS keyword_rank
           FROM chunks c
           JOIN documents d ON d.current_version_id = c.document_version_id
          WHERE c.workspace_id = $1 AND c.bot_id = $2
            AND c.embedding_dim = $3 AND c.embedding_model = $5
            AND c.tsv @@ to_tsquery('simple', $7)
          ORDER BY ts_rank(c.tsv, to_tsquery('simple', $7)) DESC, c.id
          LIMIT $6
       ), combined AS (
         SELECT chunk_id, document_id, title, url, heading_path, content, metadata, distance,
                vector_rank, NULL::int AS keyword_rank
           FROM vector_candidates
         UNION ALL
         SELECT chunk_id, document_id, title, url, heading_path, content, metadata, distance,
                NULL::int AS vector_rank, keyword_rank
           FROM keyword_candidates
       ), fused AS (
         SELECT chunk_id, document_id, title, url, heading_path, content, metadata,
                min(distance) AS distance, min(vector_rank) AS vector_rank,
                min(keyword_rank) AS keyword_rank,
                sum(CASE WHEN vector_rank IS NOT NULL THEN 1.0::float8 / (60 + vector_rank) ELSE 0 END
                  + CASE WHEN keyword_rank IS NOT NULL THEN 1.0::float8 / (60 + keyword_rank) ELSE 0 END) AS fusion_score
           FROM combined
          GROUP BY chunk_id, document_id, title, url, heading_path, content, metadata
       ), ordered AS (
         SELECT *, 1 - distance AS score, max(1 - distance) OVER () AS max_score,
                row_number() OVER (ORDER BY fusion_score DESC, 1 - distance DESC, chunk_id)::int AS fused_rank
           FROM fused
       ), prioritized AS (
         SELECT *, row_number() OVER (ORDER BY (score >= $8) DESC, fused_rank, chunk_id)::int AS output_rank
           FROM ordered
       )
       SELECT chunk_id, document_id, title, url, heading_path, content, metadata, distance,
              score, vector_rank, keyword_rank, fusion_score, max_score
         FROM prioritized
        ORDER BY output_rank LIMIT $6`,
        [
          workspaceId,
          query.botId,
          query.dim,
          `[${query.vector.join(',')}]`,
          query.embeddingModel,
          query.limit,
          terms,
          threshold,
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
        vectorRank: row.vector_rank,
        keywordRank: row.keyword_rank,
        fusionScore: row.fusion_score,
        maxScore: row.max_score,
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
