// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

import { PreferencesForm } from '@/features/notifications/preferences-form';
import { strings } from '@/strings';

export const Route = createFileRoute('/_app/w/$workspaceId/settings/notifications')({
  component: NotificationsSettingsPage,
});

function NotificationsSettingsPage() {
  const { workspaceId } = Route.useParams();
  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{strings.notifications.preferences}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {strings.notifications.preferencesDescription}
        </p>
      </div>
      <PreferencesForm workspaceId={workspaceId} />
    </section>
  );
}
