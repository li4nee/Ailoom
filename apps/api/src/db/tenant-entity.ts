// SPDX-License-Identifier: AGPL-3.0-only
import type { WorkspaceId } from './ids';

/** Base for every row that belongs to exactly one workspace. */
export abstract class TenantEntity {
  abstract id: string;
  abstract workspaceId: WorkspaceId;
}
