// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/')({
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router API
    throw redirect({ to: '/w/$workspaceId/settings/general', params });
  },
});
