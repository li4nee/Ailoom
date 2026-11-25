// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from '@tanstack/react-router';
import { Bell, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { strings } from '@/strings';
import type { NotificationDto } from '@app/shared';

import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from './api';
import { NotificationList } from './notification-list';

function destination(notification: NotificationDto, workspaceId: string) {
  if (notification.payload.conversationId !== undefined) {
    return {
      to: '/w/$workspaceId/conversations/$conversationId' as const,
      params: { workspaceId, conversationId: notification.payload.conversationId },
    };
  }
  if (notification.payload.suggestionId !== undefined) {
    return { to: '/w/$workspaceId/knowledge/suggestions' as const, params: { workspaceId } };
  }
  return { to: '/w/$workspaceId/usage' as const, params: { workspaceId } };
}

export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const query = useNotifications(workspaceId);
  const markRead = useMarkNotificationRead(workspaceId);
  const markAllRead = useMarkAllNotificationsRead(workspaceId);
  const unreadCount = query.data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const openNotification = async (notification: NotificationDto) => {
    if (notification.readAt === null) {
      await markRead.mutateAsync(notification.id).catch(() => undefined);
    }
    setOpen(false);
    await navigate(destination(notification, workspaceId));
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${strings.notifications.title}${unreadCount > 0 ? `, ${String(unreadCount)} unread` : ''}`}
        aria-expanded={open}
        aria-controls="notification-center"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="relative"
      >
        <Bell aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-destructive px-1 text-center text-[10px] leading-5 text-destructive-foreground">
            {unreadCount > 99 ? '99+' : String(unreadCount)}
          </span>
        ) : null}
      </Button>
      {open ? (
        <section
          id="notification-center"
          role="dialog"
          aria-label={strings.notifications.title}
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="font-semibold">{strings.notifications.title}</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={unreadCount === 0 || markAllRead.isPending}
              onClick={() => {
                markAllRead.mutate();
              }}
            >
              <Check aria-hidden="true" className="size-4" />
              {strings.notifications.markAllRead}
            </Button>
          </header>
          {query.isPending ? (
            <p className="p-4 text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          ) : query.isError ? (
            <p className="p-4 text-sm text-destructive" role="alert">
              {strings.notifications.loadError}
            </p>
          ) : query.data.data.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {strings.notifications.empty}
            </p>
          ) : (
            <NotificationList
              items={query.data.data}
              onOpen={(item) => {
                void openNotification(item);
              }}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
