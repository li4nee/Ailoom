// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ChunkViewDto,
  DocumentSummaryDto,
  DocumentViewDto,
  SourceDetailDto,
  SourceDto,
} from '@app/shared';

import type { DocumentVersionEntity } from './entities/document-version.entity';
import type { DocumentEntity } from './entities/document.entity';
import type { KnowledgeSourceEntity } from './entities/knowledge-source.entity';

export function toSourceDto(source: KnowledgeSourceEntity): SourceDto {
  return {
    id: source.id,
    botId: source.botId,
    type: source.type,
    title: source.title,
    sourceUrl: source.sourceUrl,
    status: source.status,
    error: source.error,
    pagesTotal: source.pagesTotal,
    pagesDone: source.pagesDone,
    pagesFailed: source.pagesFailed,
    warningCount: source.warningCount,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    recrawlInterval: source.recrawlInterval,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

export function toDocumentSummaryDto(row: {
  id: string;
  url: string | null;
  title: string | null;
  status: DocumentEntity['status'];
  warnings: DocumentVersionEntity['warnings'];
  chunkCount: number;
  lastSyncedAt: Date | null;
  lastCheckedAt: Date | null;
  unreachableSince: Date | null;
}): DocumentSummaryDto {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    status: row.status,
    warnings: row.warnings,
    chunkCount: row.chunkCount,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    unreachableSince: row.unreachableSince?.toISOString() ?? null,
  };
}

export function toSourceDetailDto(
  source: KnowledgeSourceEntity,
  documents: Parameters<typeof toDocumentSummaryDto>[0][],
  nextCursor: string | null,
): SourceDetailDto {
  return {
    ...toSourceDto(source),
    documents: documents.map(toDocumentSummaryDto),
    nextCursor,
  };
}

export function toDocumentViewDto(input: {
  document: DocumentEntity;
  currentVersion: DocumentVersionEntity | null;
  chunks: {
    ordinal: number;
    headingPath: string;
    content: string;
    tokenCount: number;
    metadata: Record<string, unknown>;
  }[];
}): DocumentViewDto {
  const chunks: ChunkViewDto[] = input.chunks.map((chunk) => ({
    ordinal: chunk.ordinal,
    headingPath: chunk.headingPath,
    content: chunk.content,
    tokenCount: chunk.tokenCount,
    metadata: chunk.metadata,
  }));
  return {
    document: {
      id: input.document.id,
      botId: input.document.botId,
      sourceId: input.document.sourceId,
      url: input.document.url,
      title: input.document.title,
      status: input.document.status,
      lastCheckedAt: input.document.lastCheckedAt?.toISOString() ?? null,
      unreachableSince: input.document.unreachableSince?.toISOString() ?? null,
      createdAt: input.document.createdAt.toISOString(),
      updatedAt: input.document.updatedAt.toISOString(),
    },
    currentVersion:
      input.currentVersion === null
        ? null
        : {
            id: input.currentVersion.id,
            content: input.currentVersion.content,
            warnings: input.currentVersion.warnings,
            createdAt: input.currentVersion.createdAt.toISOString(),
          },
    chunks,
  };
}
