// SPDX-License-Identifier: AGPL-3.0-only
import type { NotificationDto } from '@app/shared';

export function relativeNotificationTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.345, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let amount = seconds;
  for (const [divisor, unit] of divisions) {
    if (Math.abs(amount) < divisor) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
        Math.round(amount),
        unit,
      );
    }
    amount /= divisor;
  }
  return 'now';
}

export function NotificationList({
  items,
  onOpen,
}: {
  items: NotificationDto[];
  onOpen: (item: NotificationDto) => void;
}) {
  return (
    <ul className="max-h-[min(70vh,28rem)] divide-y overflow-y-auto">
      {items.map((notification) => (
        <li key={notification.id}>
          <button
            type="button"
            className="flex min-h-20 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`${notification.payload.title}. ${notification.payload.body}. ${relativeNotificationTime(notification.createdAt)}`}
            onClick={() => {
              onOpen(notification);
            }}
          >
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.readAt === null ? 'bg-primary' : 'border border-muted-foreground/50'}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{notification.payload.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {notification.payload.body}
              </span>
              <time
                className="mt-2 block text-xs text-muted-foreground"
                dateTime={notification.createdAt}
              >
                {relativeNotificationTime(notification.createdAt)}
              </time>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
