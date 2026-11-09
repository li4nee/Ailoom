// SPDX-License-Identifier: AGPL-3.0-only
import type { TestApp } from '../helpers/app';

/**
 * Isolation fixtures keyed by route param name (botId, credentialId, …;
 * workspaceId is built in). Each fixture creates the resource in workspace A
 * and returns its id.
 *
 * Empty until Task 1.18 fills in per-resource fixtures; until then the
 * isolation suite only checks route coverage.
 */
export const ISOLATION_FIXTURES: Record<string, (ctx: IsolationContext) => Promise<string>> = {};

/**
 * Routes exempt from the isolation coverage check (method + path).
 */
export const ISOLATION_EXEMPT: { method: string; path: string; reason: string }[] = [];

export interface IsolationContext {
  t: TestApp;
  wsA: string;
  userA: { id: string; token: string };
  wsB: string;
  userB: { id: string; token: string };
  cookiesB: string[];
}
