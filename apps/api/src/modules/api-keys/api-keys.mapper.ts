// SPDX-License-Identifier: AGPL-3.0-only
import type { ApiKeyDto } from '@app/shared';

import type { ApiKeyEntity } from './api-key.entity';

export function toApiKeyDto(row: ApiKeyEntity): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    scopes: row.scopes,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
