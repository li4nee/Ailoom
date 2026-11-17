// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const INTEGRATION_PROVIDERS = [
  'hubspot',
  'salesforce',
  'dynamics365',
  'zoho',
  'pipedrive',
  'zendesk',
  'intercom',
  'freshdesk',
] as const;

export const INTEGRATION_STATUSES = [
  'active',
  'paused',
  'reauth_required',
  'error',
  'disconnected',
] as const;

export const INTEGRATION_CAPABILITIES = [
  'contacts',
  'companies',
  'leads',
  'deals',
  'tickets',
  'cases',
  'conversations',
  'timeline',
  'transcripts',
] as const;

export const INTEGRATION_EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'conversation.created',
  'conversation.updated',
  'message.created',
  'handoff.requested',
  'conversation.closed',
  'feedback.created',
] as const;

export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export const integrationCapabilitySchema = z.enum(INTEGRATION_CAPABILITIES);
export const integrationEventTypeSchema = z.enum(INTEGRATION_EVENT_TYPES);

const integrationSettingsSchema = z.object({
  transcriptSharing: z.boolean().default(false),
});

export const connectIntegrationRequestSchema = z.object({
  provider: integrationProviderSchema,
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  externalAccountId: z.string().trim().min(1).max(200).optional(),
  baseUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional(),
  accessToken: z.string().min(1).max(10000),
  refreshToken: z.string().min(1).max(10000).optional(),
  tokenExpiresAt: z.iso.datetime().optional(),
  settings: integrationSettingsSchema.default({ transcriptSharing: false }),
});

export const integrationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  provider: integrationProviderSchema,
  name: z.string(),
  status: integrationStatusSchema,
  scopes: z.array(z.string()),
  externalAccountId: z.string().nullable(),
  transcriptSharing: z.boolean(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  disconnectedAt: z.string().nullable(),
});

export const integrationLinkSchema = z.object({
  id: z.string(),
  integrationId: z.string(),
  contactId: z.string(),
  objectType: z.string(),
  externalObjectId: z.string(),
  idempotencyKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type IntegrationCapability = z.infer<typeof integrationCapabilitySchema>;
export type IntegrationEventType = z.infer<typeof integrationEventTypeSchema>;
export type ConnectIntegrationRequest = z.infer<typeof connectIntegrationRequestSchema>;
export type IntegrationDto = z.infer<typeof integrationSchema>;
export type IntegrationLinkDto = z.infer<typeof integrationLinkSchema>;
