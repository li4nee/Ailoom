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

export const INTEGRATION_DELIVERY_STATUSES = [
  'pending',
  'sending',
  'retrying',
  'delivered',
  'failed',
  'skipped',
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
export const integrationDeliveryStatusSchema = z.enum(INTEGRATION_DELIVERY_STATUSES);
export const integrationCapabilitySchema = z.enum(INTEGRATION_CAPABILITIES);
export const integrationEventTypeSchema = z.enum(INTEGRATION_EVENT_TYPES);

const integrationSettingsSchema = z.object({
  transcriptSharing: z.boolean().default(false),
});

export const crmConversationContextSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  conversationQuality: z.enum(['good', 'mixed', 'poor', 'unknown']),
  leadTemperature: z.enum(['hot', 'mild', 'cold', 'unknown']),
  buyerType: z.enum(['consumer', 'small_business', 'mid_market', 'enterprise', 'unknown']),
  evidence: z.string().trim().max(300),
});

export const crmContextFieldMapSchema = z
  .object({
    summary: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,128}$/u)
      .optional(),
    conversationQuality: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,128}$/u)
      .optional(),
    leadTemperature: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,128}$/u)
      .optional(),
    buyerType: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,128}$/u)
      .optional(),
    evidence: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,128}$/u)
      .optional(),
  })
  .refine((mapping) => Object.keys(mapping).length > 0, {
    message: 'Map at least one CRM context field.',
  })
  .refine((mapping) => new Set(Object.values(mapping)).size === Object.values(mapping).length, {
    message: 'Each CRM context field must use a different CRM key.',
  });

export const connectIntegrationRequestSchema = z
  .object({
    provider: integrationProviderSchema,
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    authMode: z.enum(['bearer', 'api_key']).default('bearer'),
    authUser: z.string().trim().min(1).max(320).optional(),
    externalAccountId: z.string().trim().min(1).max(200).optional(),
    baseUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .optional(),
    accessToken: z.string().min(1).max(10000),
    crmContextFields: crmContextFieldMapSchema.optional(),
    refreshToken: z.string().min(1).max(10000).optional(),
    tokenExpiresAt: z.iso.datetime().optional(),
    settings: integrationSettingsSchema.default({ transcriptSharing: false }),
  })
  .superRefine((input, ctx) => {
    const tenantUrlRequired = [
      'salesforce',
      'dynamics365',
      'zoho',
      'zendesk',
      'freshdesk',
    ].includes(input.provider);
    if (tenantUrlRequired && input.baseUrl === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'A provider or tenant base URL is required for this CRM.',
      });
    }
    if (tenantUrlRequired && input.baseUrl !== undefined) {
      const url = new URL(input.baseUrl);
      if (
        url.protocol !== 'https:' ||
        url.username !== '' ||
        url.password !== '' ||
        (url.pathname !== '/' && url.pathname !== '') ||
        url.search !== '' ||
        url.hash !== ''
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['baseUrl'],
          message: 'A tenant base URL must be an HTTPS origin.',
        });
      }
    }
    if (
      input.provider === 'zendesk' &&
      input.authMode === 'api_key' &&
      input.authUser === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authUser'],
        message: 'Zendesk API token authentication requires the account email.',
      });
    }
    if (
      input.crmContextFields !== undefined &&
      !new Set(['hubspot', 'pipedrive', 'intercom']).has(input.provider)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['crmContextFields'],
        message:
          'Conversation context sync is currently available for HubSpot, Pipedrive, and Intercom.',
      });
    }
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
  crmContextFields: crmContextFieldMapSchema.nullable(),
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

export const integrationDeliverySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  integrationId: z.string(),
  eventId: z.string(),
  eventType: integrationEventTypeSchema,
  status: integrationDeliveryStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  lastError: z.string().nullable(),
  externalObjectType: z.string().nullable(),
  externalObjectId: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

/**
 * Providers without a recorded live delivery check. Shown as beta in the admin and docs until
 * a live smoke is recorded in docs/integrations/crm-verification.md.
 */
export const BETA_INTEGRATION_PROVIDERS = [
  'salesforce',
  'dynamics365',
  'zoho',
  'zendesk',
  'freshdesk',
] as const satisfies readonly IntegrationProvider[];

export function isBetaIntegrationProvider(provider: IntegrationProvider): boolean {
  return (BETA_INTEGRATION_PROVIDERS as readonly IntegrationProvider[]).includes(provider);
}
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type IntegrationDeliveryStatus = z.infer<typeof integrationDeliveryStatusSchema>;
export type IntegrationCapability = z.infer<typeof integrationCapabilitySchema>;
export type IntegrationEventType = z.infer<typeof integrationEventTypeSchema>;
export type ConnectIntegrationRequest = z.infer<typeof connectIntegrationRequestSchema>;
export type CrmContextFieldMap = z.infer<typeof crmContextFieldMapSchema>;
export type CrmConversationContext = z.infer<typeof crmConversationContextSchema>;
export type IntegrationDto = z.infer<typeof integrationSchema>;
export type IntegrationLinkDto = z.infer<typeof integrationLinkSchema>;
export type IntegrationDeliveryDto = z.infer<typeof integrationDeliverySchema>;
