// SPDX-License-Identifier: MIT

/** Model providers a credential can point at. */
export const PROVIDER_KINDS = [
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'mistral',
  'ollama',
  'openai_compatible',
  'local',
  'mock',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Normalized provider failures. Safe to show to a workspace admin; never carry raw bodies. */
export const PROVIDER_ERROR_CODES = [
  'auth_failed',
  'rate_limited',
  'quota_exceeded',
  'model_not_found',
  'timeout',
  'aborted',
  'connection_failed',
  'blocked_url',
  'local_model_unavailable',
  'provider_error',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];
