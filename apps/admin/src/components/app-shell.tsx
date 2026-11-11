// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useParams } from '@tanstack/react-router';
import { CircleUser } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLogout } from '@/features/auth/api';
import { strings } from '@/strings';
import type { MeResponse } from '@app/shared';

import { WorkspaceSwitcher } from './workspace-switcher';

/** The signed-in frame: product name, workspace switcher and the account menu. */
export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const logout = useLogout();
  const { workspaceId } = useParams({ strict: false });

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <Link to="/" className="font-semibold">
          {strings.app.name}
        </Link>
        {me.memberships.length > 0 ? (
          <WorkspaceSwitcher memberships={me.memberships} currentId={workspaceId} />
        ) : null}
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={strings.nav.userMenu}>
                <CircleUser aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/account">{strings.nav.account}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/account/sessions">{strings.nav.sessions}</Link>
              </DropdownMenuItem>
              {me.isInstanceAdmin ? (
                <DropdownMenuItem asChild>
                  <Link to="/instance">{strings.nav.instance}</Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  logout.mutate(undefined, {
                    onSettled: () => {
                      window.location.assign('/login');
                    },
                  });
                }}
              >
                {strings.auth.logOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {children}
    </div>
  );
}
