// SPDX-License-Identifier: AGPL-3.0-only
import type { Role } from '@app/shared';

import type { UserId, WorkspaceId } from '../../db/ids';

/**
 * Who the request acts as (spec §10.1). Roles and workspace ids deliberately do not travel
 * in the access token: they are loaded from Postgres on every request, so a demotion or
 * removal takes effect immediately.
 */
export interface Principal {
  userId: UserId;
  sessionId: string;
  isInstanceAdmin: boolean;
  emailVerified: boolean;
  authMethod: 'session' | 'api_key';
  apiKeyId: string | null;
  apiKeyScopes: readonly string[];
  workspace: { id: WorkspaceId; role: Role } | null;
}
