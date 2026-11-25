// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/lib/api-client';
import {
  notificationPreferencesDtoSchema,
  notificationsPageSchema,
  type NotificationPreferences,
} from '@app/shared';

export const notificationsKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'notifications'] as const;
export const notificationPreferencesKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'notification-preferences'] as const;

export function fetchNotifications(workspaceId: string) {
  return api(`/v1/workspaces/${encodeURIComponent(workspaceId)}/notifications?limit=30`, {
    schema: notificationsPageSchema,
  });
}

export function useNotifications(workspaceId: string) {
  return useQuery({
    queryKey: notificationsKey(workspaceId),
    queryFn: () => fetchNotifications(workspaceId),
    refetchInterval: false,
  });
}

export function useMarkNotificationRead(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      api(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/notifications/${encodeURIComponent(notificationId)}/read`,
        {
          method: 'POST',
          schema: notificationsPageSchema.shape.data.element,
        },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsKey(workspaceId) }),
  });
}

export function useMarkAllNotificationsRead(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api(`/v1/workspaces/${encodeURIComponent(workspaceId)}/notifications/read-all`, {
        method: 'POST',
        schema: z.object({ updated: z.number().int().nonnegative() }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsKey(workspaceId) }),
  });
}

export function useNotificationPreferences(workspaceId: string) {
  return useQuery({
    queryKey: notificationPreferencesKey(workspaceId),
    queryFn: () =>
      api(`/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-preferences`, {
        schema: notificationPreferencesDtoSchema,
      }),
  });
}

export function useSaveNotificationPreferences(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreferences) =>
      api(`/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-preferences`, {
        method: 'PUT',
        body: preferences,
        schema: notificationPreferencesDtoSchema,
      }),
    onSuccess: (result) => {
      client.setQueryData(notificationPreferencesKey(workspaceId), result);
    },
  });
}
