// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';

import type { CredentialModel, CredentialTestResult, ProviderErrorCode } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../common/config';
import type { CredentialId, WorkspaceId } from '../db/ids';
import { CATALOG, type CatalogProvider } from './catalog';
import { ProviderError, toProviderError } from './errors';
import { Llm } from './llm.service';
// A value import: SWC's decorator metadata references the class at load time, so a type-only
// import here would leave `ProviderRegistry` undefined in the CommonJS build.
import { ProviderRegistry } from './registry';
import {
  CREDENTIAL_RESOLVER,
  CREDENTIAL_STATUS,
  type CredentialResolver,
  type CredentialStatusWriter,
  type ResolvedCredential,
} from './types';

/** A failed probe must answer quickly: the admin is waiting on a button. */
const PROBE_TIMEOUT_MS = 15_000;
/** Enough for one token, small enough not to spend the admin's budget on a test. */
const PROBE_MAX_TOKENS = 1;
/** Minimal text for the embedding probe and the chat test. */
const PROBE_TEXT = 'ping';
/** Text embedded once to measure a model's width. */
const DIMENSION_PROBE = 'dimension probe';

/** Providers with no REST model list of their own. */
const FIXED_MODELS: Partial<Record<string, CredentialModel[]>> = {
  mock: [
    { id: 'mock-chat', kind: 'chat' },
    { id: 'mock-embed', kind: 'embedding' },
  ],
};

const LOOPBACK_HINT =
  'Inside Docker, use http://host.docker.internal:11434 or the bundled ollama service (http://ollama:11434).';
const BLOCKED_HINT =
  "This address is blocked by the instance's provider URL policy (ALLOW_PRIVATE_PROVIDER_URLS / PROVIDER_URL_ALLOWLIST).";

function isLoopback(baseUrl: string | null): boolean {
  if (baseUrl === null || !URL.canParse(baseUrl)) return false;
  const host = new URL(baseUrl).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * The admin-facing provider operations (spec §11.3): which models a credential can reach,
 * whether it works, and how wide its embeddings are. Every failure surfaces as a normalized
 * `ProviderErrorCode`, never as a raw provider body.
 */
@Injectable()
export class ProviderOps {
  /** Embedding widths measured so far, keyed by credential and model. */
  private readonly widths = new Map<string, number>();

  constructor(
    @Inject(CREDENTIAL_RESOLVER) private readonly credentials: CredentialResolver,
    @Inject(CREDENTIAL_STATUS) private readonly status: CredentialStatusWriter,
    private readonly llm: Llm,
    private readonly registry: ProviderRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listModels(
    workspaceId: WorkspaceId,
    credentialId: CredentialId,
  ): Promise<CredentialModel[]> {
    const credential = await this.credentials.resolveForUse(workspaceId, credentialId);
    const fixed = FIXED_MODELS[credential.provider];
    if (fixed !== undefined) return fixed;
    // The built-in provider embeds with the model this instance ships.
    if (credential.provider === 'local') {
      return [{ id: this.config.localEmbeddingModel, kind: 'embedding' }];
    }
    const catalog = this.catalogFor(credential);
    return catalog.listModels(credential, this.registry.providerFetch());
  }

  /**
   * Spec §11.3: one minimal call with the first chat model, or one embedding for a provider
   * without chat. The outcome is stored on the credential so the admin list shows it.
   */
  async testConnection(
    workspaceId: WorkspaceId,
    credentialId: CredentialId,
  ): Promise<CredentialTestResult> {
    const credential = await this.credentials.resolveForUse(workspaceId, credentialId);
    try {
      const models = await this.listModels(workspaceId, credentialId);
      const chat = models.find((model) => model.kind === 'chat');
      if (chat === undefined) {
        const embedding = models[0];
        if (embedding === undefined) throw new ProviderError('model_not_found');
        await this.llm.embed({
          workspaceId,
          credentialId,
          model: embedding.id,
          inputs: [PROBE_TEXT],
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
      } else {
        await this.probeChat(workspaceId, credentialId, chat.id);
      }
      await this.status.markUsed(workspaceId, credentialId);
      return { ok: true };
    } catch (error) {
      const code = toProviderError(error).code;
      await this.status.markError(workspaceId, credentialId, code);
      return { ok: false, code, hint: this.hint(code, credential.baseUrl) };
    }
  }

  /** The embedding width of `model`, measured once and cached per credential and model. */
  async dimensions(
    workspaceId: WorkspaceId,
    credentialId: CredentialId,
    model: string,
  ): Promise<number> {
    const key = `${credentialId}:${model}`;
    const cached = this.widths.get(key);
    if (cached !== undefined) return cached;

    const { vectors } = await this.llm.embed({
      workspaceId,
      credentialId,
      model,
      inputs: [DIMENSION_PROBE],
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const width = vectors[0]?.length ?? 0;
    if (width === 0) throw new ProviderError('provider_error');
    this.widths.set(key, width);
    return width;
  }

  private async probeChat(
    workspaceId: WorkspaceId,
    credentialId: CredentialId,
    model: string,
  ): Promise<void> {
    const result = this.llm.streamChat({
      workspaceId,
      credentialId,
      model,
      messages: [{ role: 'user', content: PROBE_TEXT }],
      maxOutputTokens: PROBE_MAX_TOKENS,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // The call is the test: draining both halves proves the provider answered and used tokens.
    // Nothing is done with the text; the stream must simply complete without throwing.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- draining the stream
    for await (const _delta of result.textStream) void 0;
    await result.final;
  }

  private catalogFor(credential: ResolvedCredential): CatalogProvider {
    const catalog = (CATALOG as Partial<Record<string, CatalogProvider>>)[credential.provider];
    if (catalog === undefined) throw new ProviderError('provider_error');
    return catalog;
  }

  private hint(code: ProviderErrorCode, baseUrl: string | null): string | null {
    if (code === 'blocked_url') return BLOCKED_HINT;
    if (code === 'connection_failed' && isLoopback(baseUrl)) return LOOPBACK_HINT;
    return null;
  }
}
