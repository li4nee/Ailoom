// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { strings } from '@/strings';
import type { ConversationSla } from '@app/shared';

export function SlaIndicator({ sla }: { sla: ConversationSla }) {
  const [now, setNow] = useState(() => Date.now());
  const responseDue = sla.firstResponseDueAt;
  const resolutionDue = sla.resolutionDueAt;

  useEffect(() => {
    if (responseDue === null && resolutionDue === null) return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [responseDue, resolutionDue]);

  const responseBreached = sla.firstResponseBreachedAt !== null;
  const resolutionBreached = sla.resolutionBreachedAt !== null;
  if (!responseBreached && !resolutionBreached && responseDue === null && resolutionDue === null) {
    return null;
  }

  const activeDeadlines = [
    ...(responseDue === null ? [] : [{ kind: 'firstResponse' as const, at: responseDue }]),
    ...(resolutionDue === null ? [] : [{ kind: 'resolution' as const, at: resolutionDue }]),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const nextDeadline = activeDeadlines[0];
  const overdue = nextDeadline !== undefined && Date.parse(nextDeadline.at) <= now;
  const remainingMinutes =
    nextDeadline === undefined
      ? 0
      : Math.max(0, Math.ceil((Date.parse(nextDeadline.at) - now) / 60_000));
  const label = responseBreached
    ? `${strings.conversations.sla.firstResponse}: ${strings.conversations.sla.breached}`
    : resolutionBreached
      ? `${strings.conversations.sla.resolution}: ${strings.conversations.sla.breached}`
      : `${
          strings.conversations.sla[nextDeadline?.kind ?? 'firstResponse']
        }: ${overdue ? strings.conversations.sla.overdue : strings.conversations.sla.dueIn(remainingMinutes)}`;

  return (
    <Badge variant={responseBreached || resolutionBreached || overdue ? 'destructive' : 'outline'}>
      {label}
    </Badge>
  );
}
