// SPDX-License-Identifier: AGPL-3.0-only
import type { WorkspaceId } from '../../src/db/ids';
import type { TestApp } from '../helpers/app';

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
export const ISOLATION_FIXTURES: Record<string, (ctx: IsolationContext) => Promise<string>> = {};

/** Workspace-scoped routes that need no isolation check, each with the reason. */
export const ISOLATION_EXEMPT: { method: string; path: string; reason: string }[] = [];
