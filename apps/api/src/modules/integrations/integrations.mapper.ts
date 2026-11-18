// SPDX-License-Identifier: AGPL-3.0-only
import type { IntegrationDto } from '@app/shared';

import type { IntegrationEntity } from './integration.entity';

export function toIntegrationDto(row: IntegrationEntity): IntegrationDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    provider: row.provider,
    name: row.name,
    status: row.status,
    scopes: row.scopes,
    externalAccountId: row.externalAccountId,
    transcriptSharing: row.transcriptSharing,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
  };
}
