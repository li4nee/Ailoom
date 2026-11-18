// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const API_KEY_SCOPES = [
  'contacts:read',
  'contacts:write',
  'conversations:read',
  'conversations:write',
  'webhooks:read',
  'webhooks:write',
  'integrations:manage',
] as const;

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

export const createApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(apiKeyScopeSchema).min(1).max(API_KEY_SCOPES.length),
  expiresAt: z.string().trim().min(1).max(64).optional(),
});

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  createdByUserId: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const createdApiKeySchema = z.object({
  key: apiKeySchema,
  token: z.string(),
});

export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;
export type ApiKeyDto = z.infer<typeof apiKeySchema>;
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;
