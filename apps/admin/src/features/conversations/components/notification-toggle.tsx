// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Label } from '@/components/ui/label';
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
} from '@/lib/notifications';
import { strings } from '@/strings';

/** Opting in is a click: browsers require a user gesture before asking for permission. */
export function NotificationToggle() {
  const [enabled, setEnabled] = useState(notificationsEnabled);
  const [blocked, setBlocked] = useState(false);

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (!event.target.checked) {
              disableNotifications();
              setEnabled(false);
              return;
            }
            void enableNotifications().then((granted) => {
              setEnabled(granted);
              setBlocked(!granted);
            });
          }}
        />
        <Label>{strings.conversations.notifications}</Label>
      </label>
      <p className="text-xs text-muted-foreground">{strings.conversations.notificationsHint}</p>
      <FormAlert message={blocked ? strings.conversations.notificationsBlocked : null} />
    </div>
  );
}
