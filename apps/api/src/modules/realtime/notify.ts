// SPDX-License-Identifier: AGPL-3.0-only
import type { EntityManager } from 'typeorm';

import type { RealtimeEvent } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';

/**
 * Postgres rejects a notification payload of 8000 bytes or more; stay below it so a payload
 * that grows still fails here, with a clear error, rather than inside `pg_notify`.
 */
export const NOTIFY_MAX_BYTES = 7900;

/**
 * The LISTEN/NOTIFY channel of a workspace (spec §18.3). A channel name is a Postgres
 * identifier (63 bytes), so the dashes of the UUID are dropped: `ws_<32 hex chars>`.
 */
export function workspaceChannel(workspaceId: WorkspaceId | string): string {
  return `ws_${workspaceId.replaceAll('-', '')}`;
}

/**
 * Sends `event` on the workspace's channel, on the caller's transaction: Postgres delivers it
 * only if that transaction commits, so a rolled-back write never produces a notification
 * (spec §18.3). Raw SQL because Postgres has no other way to notify; the payload is bound as a
 * parameter, never interpolated.
 */
export async function notifyWorkspace(
  manager: EntityManager,
  workspaceId: WorkspaceId,
  event: RealtimeEvent,
): Promise<void> {
  const payload = JSON.stringify(event);
  const bytes = Buffer.byteLength(payload, 'utf8');
  if (bytes > NOTIFY_MAX_BYTES) {
    throw new AppError('internal_error', {
      message: `Realtime event ${event.type} is ${String(bytes)} bytes, over the ${String(NOTIFY_MAX_BYTES)}-byte notification limit.`,
    });
  }
  await manager.query('SELECT pg_notify($1, $2)', [workspaceChannel(workspaceId), payload]);
}
