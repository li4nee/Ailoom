// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { ROLES, type Role } from './enums.js';

export const NOTIFICATION_TYPES = [
  'handoff_requested',
  'conversation_assigned',
  'visitor_replied',
  'spend_alert',
  'suggestion_created',
  'suggestion_reviewed',
  'sla_breached',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationPayloadSchema = z.object({
  conversationId: z.uuid().optional(),
  botId: z.uuid().optional(),
  suggestionId: z.uuid().optional(),
  title: z.string().min(1).max(160),
  body: z.string().max(500),
});

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  payload: notificationPayloadSchema,
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const notificationQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const notificationPreferenceSchema = z.object({ email: z.boolean(), inApp: z.boolean() });
export const notificationPreferencesSchema = z.partialRecord(
  z.enum(NOTIFICATION_TYPES),
  notificationPreferenceSchema,
);
export const notificationPreferencesDtoSchema = z.record(
  z.enum(NOTIFICATION_TYPES),
  notificationPreferenceSchema,
);
export const notificationsPageSchema = z.object({
  data: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
export type NotificationDto = z.infer<typeof notificationSchema>;
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesDtoSchema>;

/** Default channels by member role; missing stored keys always fall back here. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  Role,
  Record<NotificationType, NotificationPreference>
> = {
  owner: {
    handoff_requested: { email: true, inApp: true },
    conversation_assigned: { email: true, inApp: true },
    visitor_replied: { email: false, inApp: true },
    spend_alert: { email: true, inApp: true },
    suggestion_created: { email: false, inApp: true },
    suggestion_reviewed: { email: false, inApp: true },
    sla_breached: { email: true, inApp: true },
  },
  admin: {
    handoff_requested: { email: true, inApp: true },
    conversation_assigned: { email: true, inApp: true },
    visitor_replied: { email: false, inApp: true },
    spend_alert: { email: true, inApp: true },
    suggestion_created: { email: false, inApp: true },
    suggestion_reviewed: { email: false, inApp: true },
    sla_breached: { email: true, inApp: true },
  },
  agent: {
    handoff_requested: { email: false, inApp: true },
    conversation_assigned: { email: true, inApp: true },
    visitor_replied: { email: false, inApp: true },
    spend_alert: { email: false, inApp: true },
    suggestion_created: { email: false, inApp: false },
    suggestion_reviewed: { email: false, inApp: true },
    sla_breached: { email: false, inApp: false },
  },
};

export function effectivePreferences(
  role: Role,
  stored: NotificationPreferences | null | undefined,
): NotificationPreferencesDto {
  const defaults = DEFAULT_NOTIFICATION_PREFERENCES[role];
  const result = {} as NotificationPreferencesDto;
  for (const type of NOTIFICATION_TYPES) {
    result[type] = { ...defaults[type], ...stored?.[type] };
  }
  return result;
}

export const notificationRoleSchema = z.enum(ROLES);
