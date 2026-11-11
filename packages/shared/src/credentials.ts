// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { PROVIDER_KINDS, PROVIDER_ERROR_CODES } from './providers.js';

/** A pasted API key; whitespace is trimmed so a trailing newline never reaches the cipher. */
const apiKeySchema = z.string().trim().min(1).max(500);

/**
 * A provider endpoint. Query strings and fragments are rejected: they are never part of a
 * provider's base URL and would be silently dropped from every request the SDK builds.
 */
export const credentialBaseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/ }))
  .refine((value) => {
    const { search, hash } = new URL(value);
    return search === '' && hash === '';
  }, 'Must not contain a query string or fragment.');

export const credentialLabelSchema = z.string().trim().min(1).max(80);

/** Providers whose SDK authenticates with an API key that the admin must supply. */
const keyed = (provider: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral') =>
  z.object({
    provider: z.literal(provider),
    label: credentialLabelSchema,
    apiKey: apiKeySchema,
  });

/**
 * What `POST /workspaces/:ws/credentials` accepts. `local` is built in (one per workspace,
 * created automatically in Task 2.6) and cannot be created through the API.
 */
export const createCredentialSchema = z.discriminatedUnion('provider', [
  keyed('openai'),
  keyed('anthropic'),
  keyed('gemini'),
  keyed('groq'),
  keyed('mistral'),
  z.object({
    provider: z.literal('ollama'),
    label: credentialLabelSchema,
    baseUrl: credentialBaseUrlSchema,
  }),
  z.object({
    provider: z.literal('openai_compatible'),
    label: credentialLabelSchema,
    apiKey: apiKeySchema.optional(),
    baseUrl: credentialBaseUrlSchema,
  }),
  // `mock` needs no key: it never leaves the process. Allowed outside production only.
  z.object({
    provider: z.literal('mock'),
    label: credentialLabelSchema,
    apiKey: apiKeySchema.optional(),
  }),
]);

/** `PATCH /workspaces/:ws/credentials/:id`; which fields are allowed depends on the provider. */
export const updateCredentialSchema = z.object({
  label: credentialLabelSchema.optional(),
  apiKey: apiKeySchema.optional(),
  baseUrl: credentialBaseUrlSchema.optional(),
});

/**
 * A credential as the API returns it. There is deliberately no field that could hold the
 * ciphertext, the IV, the tag or the decrypted key.
 */
export const credentialDtoSchema = z.object({
  id: z.string(),
  provider: z.enum(PROVIDER_KINDS),
  label: z.string(),
  secretLast4: z.string().nullable(),
  baseUrl: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** One model a credential can reach, as `GET …/credentials/:id/models` reports it. */
export const credentialModelSchema = z.object({
  id: z.string(),
  kind: z.enum(['chat', 'embedding']),
});

/** `POST …/credentials/:id/test`: a normalized code plus an operator hint, never a raw body. */
export const credentialTestResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    code: z.enum(PROVIDER_ERROR_CODES),
    hint: z.string().nullable(),
  }),
]);

export type CreateCredentialRequest = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialRequest = z.infer<typeof updateCredentialSchema>;
export type CredentialDto = z.infer<typeof credentialDtoSchema>;
export type CredentialModel = z.infer<typeof credentialModelSchema>;
export type CredentialTestResult = z.infer<typeof credentialTestResultSchema>;
