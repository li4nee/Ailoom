// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { INTEGRATION_EVENT_TYPES, integrationEventTypeSchema } from './integrations.js';

export const WEBHOOK_STATUSES = ['active', 'paused'] as const;
export const WEBHOOK_DELIVERY_STATUSES = [
  'pending',
  'retrying',
  'delivered',
  'failed',
  'skipped',
] as const;

export const webhookStatusSchema = z.enum(WEBHOOK_STATUSES);
export const webhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);

export const createWebhookRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2048),
  events: z.array(integrationEventTypeSchema).min(1).max(INTEGRATION_EVENT_TYPES.length),
});

export const webhookSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  url: z.string(),
  events: z.array(integrationEventTypeSchema),
  status: webhookStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastError: z.string().nullable(),
});

export const createdWebhookSchema = z.object({
  webhook: webhookSchema,
  secret: z.string(),
});

export const webhookDeliverySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  webhookId: z.string(),
  eventId: z.string(),
  eventType: integrationEventTypeSchema,
  status: webhookDeliveryStatusSchema,
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  attemptCount: z.number().int(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});

export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;
export type WebhookDto = z.infer<typeof webhookSchema>;
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;
export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;
