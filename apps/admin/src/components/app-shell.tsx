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
import { VerifyEmailBanner } from '@/features/auth/components/verify-email-banner';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { strings } from '@/strings';
import type { MeResponse } from '@app/shared';

import { WorkspaceSwitcher } from './workspace-switcher';

/** The signed-in frame: product name, workspace switcher and the account menu. */
export function AppShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const logout = useLogout();
  const { workspaceId } = useParams({ strict: false });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="app-topbar sticky top-0 z-40 border-b">
        <div className="mx-auto flex min-h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="text-base font-semibold tracking-[-0.035em]">
            {strings.app.name}
          </Link>
          <span aria-hidden="true" className="brand-divider h-5 w-px" />
          {me.memberships.length > 0 ? (
            <WorkspaceSwitcher memberships={me.memberships} currentId={workspaceId} />
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {workspaceId === undefined ? null : <NotificationBell workspaceId={workspaceId} />}
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
        </div>
      </header>
      <VerifyEmailBanner emailVerified={me.emailVerified} />
      {children}
    </div>
  );
}
