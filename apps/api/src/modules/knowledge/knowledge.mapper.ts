// SPDX-License-Identifier: AGPL-3.0-only
import type { SourceDto } from '@app/shared';

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
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
