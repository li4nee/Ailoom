// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { SessionsPanel } from '@/features/account/components/sessions-panel';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/account/sessions')({
  component: () => (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{strings.account.sessionsTitle}</h1>
      <SessionsPanel
        onLoggedOut={() => {
          window.location.assign('/login');
        }}
      />
    </div>
  ),
});
