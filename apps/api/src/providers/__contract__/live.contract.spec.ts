// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The provider contracts against real APIs. Opt-in only: every provider is skipped unless its
 * `LIVE_*` variables are set, so a normal `pnpm test` never touches the network. Run by the
 * manual `live-providers` workflow (`.github/workflows/live-providers.yml`).
 */
import { describe, expect, it } from 'vitest';

import { SystemClock } from '../../common/clock';
import { loadConfig } from '../../common/config';
import { asCredentialId, asWorkspaceId } from '../../db/ids';
import { CATALOG, type ByokProviderKind } from '../catalog';
import { ProviderError } from '../errors';
import { Llm } from '../llm.service';
import { ModelCatalog } from '../model-catalog';
import { ProviderRegistry } from '../registry';
import type { ResolvedCredential } from '../types';
import { runChatContract, runToolCallingContract } from './chat-contract';
import { runEmbeddingContract } from './embedding-contract';

/** Every provider a run can cover, with where its settings come from. */
interface LiveProvider {
  kind: ByokProviderKind;
  /** Set when the provider needs an API key; the value is the env var holding it. */
  keyEnv?: string;
  /** Set instead of `keyEnv` when the provider is reached at an operator URL. */
  urlEnv?: string;
  chatModelEnv: string;
  chatModelDefault: string;
  embedModelEnv?: string;
  embedModelDefault?: string;
}

const PROVIDERS: LiveProvider[] = [
  {
    kind: 'openai',
    keyEnv: 'LIVE_OPENAI_KEY',
    chatModelEnv: 'LIVE_OPENAI_CHAT_MODEL',
    chatModelDefault: 'gpt-4o-mini',
    embedModelEnv: 'LIVE_OPENAI_EMBED_MODEL',
    embedModelDefault: 'text-embedding-3-small',
  },
  {
    kind: 'anthropic',
    keyEnv: 'LIVE_ANTHROPIC_KEY',
    chatModelEnv: 'LIVE_ANTHROPIC_CHAT_MODEL',
    chatModelDefault: 'claude-haiku-4-5',
  },
  {
    kind: 'gemini',
    keyEnv: 'LIVE_GEMINI_KEY',
    chatModelEnv: 'LIVE_GEMINI_CHAT_MODEL',
    chatModelDefault: 'gemini-3.8-flash',
    embedModelEnv: 'LIVE_GEMINI_EMBED_MODEL',
    embedModelDefault: 'gemini-embedding-001',
  },
  {
    kind: 'groq',
    keyEnv: 'LIVE_GROQ_KEY',
    chatModelEnv: 'LIVE_GROQ_CHAT_MODEL',
    chatModelDefault: 'llama-3.1-8b-instant',
  },
  {
    kind: 'mistral',
    keyEnv: 'LIVE_MISTRAL_KEY',
    chatModelEnv: 'LIVE_MISTRAL_CHAT_MODEL',
    chatModelDefault: 'mistral-small-latest',
    embedModelEnv: 'LIVE_MISTRAL_EMBED_MODEL',
    embedModelDefault: 'mistral-embed',
  },
  {
    kind: 'ollama',
    urlEnv: 'LIVE_OLLAMA_URL',
    chatModelEnv: 'LIVE_OLLAMA_CHAT_MODEL',
    chatModelDefault: 'qwen2.5:0.5b',
    embedModelEnv: 'LIVE_OLLAMA_EMBED_MODEL',
    embedModelDefault: 'nomic-embed-text',
  },
  {
    kind: 'openai_compatible',
    urlEnv: 'LIVE_OPENAI_COMPAT_URL',
    keyEnv: 'LIVE_OPENAI_COMPAT_KEY',
    chatModelEnv: 'LIVE_OPENAI_COMPAT_CHAT_MODEL',
    chatModelDefault: 'gpt-4o-mini',
  },
];

const workspaceId = asWorkspaceId('00000000-0000-7000-8000-000000000001');
const credentialId = asCredentialId('00000000-0000-7000-8000-000000000002');
/** Not used to connect anywhere: the registry is built from config, never from the database. */
const UNUSED_DATABASE_URL = 'postgres://live:live@127.0.0.1:5432/live';

function registry(): ProviderRegistry {
  return new ProviderRegistry(
    loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: UNUSED_DATABASE_URL,
      AUTH_SECRET: 'a'.repeat(32),
      WIDGET_SECRET: 'w'.repeat(32),
      ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
      // Ollama and self-hosted gateways live on private addresses by definition.
      ALLOW_PRIVATE_PROVIDER_URLS: 'true',
    }),
  );
}

function target(provider: LiveProvider): {
  llm: Llm;
  credential: ResolvedCredential;
  key: string | null;
  baseUrl: string | null;
} | null {
  const key = provider.keyEnv === undefined ? null : (process.env[provider.keyEnv] ?? null);
  const baseUrl = provider.urlEnv === undefined ? null : (process.env[provider.urlEnv] ?? null);
  const configured =
    (provider.keyEnv === undefined || key !== null) &&
    (provider.urlEnv === undefined || baseUrl !== null);
  if (!configured) return null;

  const credential: ResolvedCredential = {
    id: credentialId,
    workspaceId,
    provider: provider.kind,
    apiKey: key,
    baseUrl,
    updatedAt: new Date(),
  };
  const resolver = {
    resolveForUse: (): Promise<ResolvedCredential> => Promise.resolve(credential),
  };
  const llm = new Llm(registry(), resolver, new SystemClock());
  return { llm, credential, key, baseUrl };
}

describe('live provider contracts', () => {
  for (const provider of PROVIDERS) {
    const settings = target(provider);
    const reason = `set ${provider.urlEnv ?? provider.keyEnv ?? ''} to run the ${provider.kind} contract`;

    if (settings === null) {
      it.todo(`live ${provider.kind}: ${reason}`);
      continue;
    }

    const chatModel = process.env[provider.chatModelEnv] ?? provider.chatModelDefault;
    const chatTarget = {
      llm: settings.llm,
      credentialId,
      workspaceId,
      model: chatModel,
    };
    runChatContract(`live ${provider.kind}`, () => chatTarget, { skipErrorCases: true });

    describe(`live ${provider.kind}`, () => {
      if (process.env['LIVE_TOOL_PROVIDER'] === provider.kind) {
        it('selected chat model is reviewed for tool calling', () => {
          expect(ModelCatalog.supportsToolCalling(provider.kind, chatModel)).toBe(true);
        });
        runToolCallingContract(`live ${provider.kind}`, () => chatTarget);
      }

      it('lists at least one chat model', async () => {
        const catalog = CATALOG[provider.kind];
        const models = await catalog.listModels(settings.credential, registry().providerFetch());
        expect(models.some((model) => model.kind === 'chat')).toBe(true);
      });

      if (provider.keyEnv !== undefined) {
        it('maps a bad key to auth_failed', async () => {
          const bad: ResolvedCredential = {
            ...settings.credential,
            apiKey: 'sk-invalid-live-contract-key',
          };
          const llm = new Llm(
            registry(),
            { resolveForUse: (): Promise<ResolvedCredential> => Promise.resolve(bad) },
            new SystemClock(),
          );
          const failure: unknown = await llm
            .embed({
              workspaceId,
              credentialId,
              model: provider.embedModelDefault ?? chatModel,
              inputs: ['ping'],
              signal: AbortSignal.timeout(30_000),
            })
            .catch((error: unknown) => error);
          expect(failure).toBeInstanceOf(ProviderError);
          expect(failure).toMatchObject({ code: 'auth_failed' });
        }, 30_000);
      }

      if (provider.embedModelEnv !== undefined) {
        const embedModel = process.env[provider.embedModelEnv] ?? provider.embedModelDefault ?? '';
        const dimensions = ModelCatalog.embedding(provider.kind, embedModel)?.dimensions ?? 0;
        if (dimensions > 0) {
          runEmbeddingContract(`live ${provider.kind}`, () => ({
            llm: settings.llm,
            credentialId,
            workspaceId,
            model: embedModel,
            dimensions,
          }));
        }
      }
    });
  }
});
