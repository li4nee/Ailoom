// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from '@tanstack/react-router';

import { loadMe } from '@/features/auth/api';

/** Home: the first workspace, or the create-workspace page for a user with none. */
export const Route = createFileRoute('/_app/')({
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    const first = me?.memberships[0];
    /* eslint-disable @typescript-eslint/only-throw-error -- TanStack Router API */
    if (first === undefined) throw redirect({ to: '/new-workspace' });
    throw redirect({ to: '/w/$workspaceId', params: { workspaceId: first.workspaceId } });
    /* eslint-enable @typescript-eslint/only-throw-error */
  },
});
