// SPDX-License-Identifier: AGPL-3.0-only
import { sha256Hex } from '../../src/common/crypto';
import type { WorkspaceId } from '../../src/db/ids';
import type { TestApp } from '../helpers/app';
import { createUser } from '../helpers/factories';

/** Two workspaces with one member each; B's session cookies. Filled in by Task 1.18. */
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
 * as a member of workspace B and expects 404. Empty until the first workspace-scoped routes
 * exist (Task 1.18); until then the suite only checks coverage.
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
