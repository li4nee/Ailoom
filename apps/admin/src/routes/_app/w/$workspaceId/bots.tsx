// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RoleGate } from '@/components/role-gate';

/** Agents read bots (spec §17.5); the forms inside are read-only for them. */
export const Route = createFileRoute('/_app/w/$workspaceId/bots')({
  component: function BotsLayout() {
    return (
      <RoleGate min="agent">
        <Outlet />
      </RoleGate>
    );
  },
});
