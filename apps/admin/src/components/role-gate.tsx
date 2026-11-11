// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, type ReactNode, useContext } from 'react';

import type { Role } from '@app/shared';

const RANK: Record<Role, number> = { owner: 3, admin: 2, agent: 1 };

const WorkspaceRoleContext = createContext<Role | null>(null);

/** Set by the workspace layout from the user's membership; read by `RoleGate` and pages. */
export function WorkspaceRoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <WorkspaceRoleContext.Provider value={role}>{children}</WorkspaceRoleContext.Provider>;
}

export function useWorkspaceRole(): Role | null {
  return useContext(WorkspaceRoleContext);
}

export function hasRole(role: Role | null, min: Role): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

/**
 * Hides controls the user's role cannot use. Presentation only: the API enforces every rule,
 * so a hidden control is a courtesy, not the security boundary.
 */
export function RoleGate({ min, children }: { min: Role; children: ReactNode }) {
  return hasRole(useWorkspaceRole(), min) ? <>{children}</> : null;
}
