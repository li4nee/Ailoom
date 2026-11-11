// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '@/components/app-shell';
import { loadMe, useMe } from '@/features/auth/api';
import { strings } from '@/strings';

/** Every signed-in page. Signed-out visitors go to /login and come back afterwards. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient);
    if (me === null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router API
      throw redirect({ to: '/login', search: { next: location.href } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const me = useMe();
  if (me.data === undefined || me.data === null) return <p role="status">{strings.app.loading}</p>;
  return (
    <AppShell me={me.data}>
      <Outlet />
    </AppShell>
  );
}
