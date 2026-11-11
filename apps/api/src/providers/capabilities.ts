// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderKind } from '@app/shared';

/** Providers that serve chat completions. `local` is embeddings only (spec §9.2). */
const CHAT: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'mistral',
  'ollama',
  'openai_compatible',
  'mock',
]);

/** Providers that serve embeddings. Anthropic and Groq do not offer an embeddings API. */
const EMBEDDINGS: ReadonlySet<ProviderKind> = new Set<ProviderKind>([
  'openai',
  'gemini',
  'mistral',
  'ollama',
  'openai_compatible',
  'local',
  'mock',
]);

/**
 * Static provider capabilities, checked when a bot is saved. This is deliberately not the
 * credential's model list: `GET …/models` calls the provider, and saving a bot must not depend
 * on that call succeeding.
 */
export function supportsChat(provider: ProviderKind): boolean {
  return CHAT.has(provider);
}

export function supportsEmbeddings(provider: ProviderKind): boolean {
  return EMBEDDINGS.has(provider);
}
