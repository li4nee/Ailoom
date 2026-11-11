// SPDX-License-Identifier: AGPL-3.0-only
import { sha256Hex } from '../../src/common/crypto';
import type { WorkspaceId } from '../../src/db/ids';
import type { TestApp } from '../helpers/app';
import { createUser } from '../helpers/factories';

/** Two workspaces with one owner each; B's session cookies. Built by `buildIsolationContext`. */
export interface IsolationContext {
  t: TestApp;
  wsA: WorkspaceId;
  userA: { id: string };
  wsB: WorkspaceId;
  userB: { id: string };
  cookiesB: string[];
}

/**
 * Keyed by route param name (`botId`, `credentialId`, …; `workspaceId` is built in). Each
 * fixture creates the resource in workspace A and returns its id; the suite then requests it
 * as a member of workspace B and expects 404.
 */
export const ISOLATION_FIXTURES: Record<string, (ctx: IsolationContext) => Promise<string>> = {
  /** An agent of workspace A. */
  userId: async ({ t, wsA }) => {
    const { user } = await createUser({ ds: t.ds }, { email: `agent-${wsA}@example.com` });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [wsA, user.id],
    );
    return user.id;
  },
  /** A provider credential of workspace A (the mock provider needs no secret). */
  credentialId: async ({ t, wsA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Isolation') RETURNING id`,
      [wsA],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('credentialId fixture: insert returned no id');
    return id;
  },
  /** A pending invitation of workspace A. */
  invitationId: async ({ t, wsA, userA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, 'agent', $3, $4, now() + interval '7 days') RETURNING id`,
      [wsA, `invitee-${wsA}@example.com`, sha256Hex(`isolation-${wsA}`), userA.id],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('invitationId fixture: insert returned no id');
    return id;
  },
};

/** Workspace-scoped routes that need no isolation check, each with the reason. */
export const ISOLATION_EXEMPT: { method: string; path: string; reason: string }[] = [];

/**
 * Valid request bodies, keyed by `METHOD /path`, so a request with B's own workspace id reaches
 * the service (instead of failing validation) and the service's tenant check is what answers.
 * `ids` holds the fixture ids of workspace A, including `memberUserId` for body references.
 */
export const ISOLATION_BODIES: Record<string, (ids: Record<string, string>) => unknown> = {
  'PATCH /api/v1/workspaces/:workspaceId': () => ({ name: 'Renamed by B' }),
  'PATCH /api/v1/workspaces/:workspaceId/members/:userId': () => ({ role: 'admin' }),
  'POST /api/v1/workspaces/:workspaceId/invitations': () => ({
    email: 'isolation@example.com',
    role: 'agent',
  }),
  'POST /api/v1/workspaces/:workspaceId/transfer-ownership': (ids) => ({
    userId: ids['userId'],
  }),
  'POST /api/v1/workspaces/:workspaceId/credentials': () => ({
    provider: 'mock',
    label: 'Isolation',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/credentials/:credentialId': () => ({
    label: 'Renamed by B',
  }),
  'POST /api/v1/workspaces/:workspaceId/credentials/:credentialId/test': () => ({}),
  'PUT /api/v1/workspaces/:workspaceId/model-prices': () => ({ prices: [] }),
};

/**
 * Routes whose body names a resource of workspace A. They are also called with B's own
 * workspace id, where only the service's tenant check can answer 404.
 */
export const BODY_REFERENCES = new Set(['POST /api/v1/workspaces/:workspaceId/transfer-ownership']);
