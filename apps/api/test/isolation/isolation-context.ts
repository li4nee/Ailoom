// SPDX-License-Identifier: AGPL-3.0-only
import { asWorkspaceId } from '../../src/db/ids';
import type { TestApp } from '../helpers/app';
import { createUser, createWorkspace, loginAs } from '../helpers/factories';
import type { IsolationContext } from './isolation-fixtures';

/**
 * Workspace A (owner A plus an agent added by the `userId` fixture) and workspace B (owner B).
 * Requests are made as B's owner, who is a member of B only.
 */
export async function buildIsolationContext(t: TestApp): Promise<IsolationContext> {
  const { user: userA } = await createUser({ ds: t.ds }, { email: 'owner-a@example.com' });
  const { user: userB, password } = await createUser(
    { ds: t.ds },
    { email: 'owner-b@example.com' },
  );
  const wsA = await createWorkspace(t, userA, 'Workspace A');
  const wsB = await createWorkspace(t, userB, 'Workspace B');
  return {
    t,
    wsA: asWorkspaceId(wsA.id),
    userA: { id: userA.id },
    wsB: asWorkspaceId(wsB.id),
    userB: { id: userB.id },
    cookiesB: await loginAs(t, userB, password),
    ids: {},
  };
}
