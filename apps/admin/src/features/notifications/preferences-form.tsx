// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { strings } from '@/strings';
import {
  NOTIFICATION_TYPES,
  type NotificationPreferencesDto,
  type NotificationType,
} from '@app/shared';

import { useNotificationPreferences, useSaveNotificationPreferences } from './api';

export function PreferencesForm({ workspaceId }: { workspaceId: string }) {
  const query = useNotificationPreferences(workspaceId);
  const save = useSaveNotificationPreferences(workspaceId);
  if (query.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {strings.notifications.preferencesError}
      </p>
    );
  }
  if (query.isPending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Loading…
      </p>
    );
  }
  return (
    <PreferencesEditor
      key={workspaceId}
      initial={query.data}
      isPending={save.isPending}
      isError={save.isError}
      onSave={(preferences, onSuccess) => {
        save.mutate(preferences, { onSuccess });
      }}
    />
  );
}

function PreferencesEditor({
  initial,
  isPending,
  isError,
  onSave,
}: {
  initial: NotificationPreferencesDto;
  isPending: boolean;
  isError: boolean;
  onSave: (preferences: NotificationPreferencesDto, onSuccess: () => void) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);

  const toggle = (type: NotificationType, channel: 'email' | 'inApp', checked: boolean) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [type]: { ...current[type], [channel]: checked } }));
  };

  const submit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(draft, () => {
      setSaved(true);
    });
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        {strings.notifications.preferencesDescription}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 font-medium" scope="col">
                Notification
              </th>
              <th className="px-4 py-3 text-center font-medium" scope="col">
                {strings.notifications.email}
              </th>
              <th className="px-4 py-3 text-center font-medium" scope="col">
                {strings.notifications.inApp}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {NOTIFICATION_TYPES.map((type) => (
              <tr key={type}>
                <th className="px-4 py-3 font-normal" scope="row">
                  {strings.notifications.types[type]}
                </th>
                {(['email', 'inApp'] as const).map((channel) => (
                  <td key={channel} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      checked={draft[type][channel]}
                      aria-label={`${strings.notifications.types[type]} — ${strings.notifications[channel]}`}
                      onChange={(event) => {
                        toggle(type, channel, event.currentTarget.checked);
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.notifications.saving : strings.notifications.save}
        </Button>
        {saved ? (
          <span className="text-sm text-muted-foreground" role="status">
            {strings.notifications.saved}
          </span>
        ) : null}
        {isError ? (
          <span className="text-sm text-destructive" role="alert">
            {strings.notifications.saveError}
          </span>
        ) : null}
      </div>
    </form>
  );
}
