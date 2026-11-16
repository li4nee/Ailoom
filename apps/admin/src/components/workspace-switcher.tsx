// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { strings } from '@/strings';
import type { MembershipSummary } from '@app/shared';

export function WorkspaceSwitcher({
  memberships,
  currentId,
}: {
  memberships: MembershipSummary[];
  currentId: string | undefined;
}) {
  const current = memberships.find((m) => m.workspaceId === currentId);
  // The visible workspace name must appear in the accessible name (axe label-content-name-mismatch).
  const switchLabel =
    current === undefined
      ? strings.nav.switchWorkspace
      : `${strings.nav.switchWorkspace}: ${current.workspaceName}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={switchLabel} className="gap-2">
          <span className="max-w-48 truncate">
            {current?.workspaceName ?? strings.nav.switchWorkspace}
          </span>
          <ChevronsUpDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {memberships.map((m) => (
          <DropdownMenuItem key={m.workspaceId} asChild>
            <Link to="/w/$workspaceId" params={{ workspaceId: m.workspaceId }}>
              {m.workspaceName}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/new-workspace">{strings.nav.newWorkspace}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
