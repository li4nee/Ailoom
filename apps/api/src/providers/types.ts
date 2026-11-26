// SPDX-License-Identifier: AGPL-3.0-only
import type { EmbeddingModelV4, LanguageModelV4 } from '@ai-sdk/provider';
import type { JSONSchema7, ModelMessage } from 'ai';

import type { ProviderErrorCode, ProviderKind } from '@app/shared';

import type { CredentialId, WorkspaceId } from '../db/ids';

/** Re-exported so callers build prompts without importing `ai` themselves. */
export type { ModelMessage };

/** A model the registry hands out. Never a bare model-id string (that would route to a gateway). */
export type ChatModel = LanguageModelV4;
export type EmbeddingModel = EmbeddingModelV4;

/** A credential decrypted for one call. Never logged, never cached beyond the registry. */
export interface ResolvedCredential {
  id: CredentialId;
  workspaceId: WorkspaceId;
  provider: ProviderKind;
  apiKey: string | null;
  baseUrl: string | null;
  updatedAt: Date;
}

/** Loads a credential through the workspace's tenant scope; an id from another workspace is not found. */
export interface CredentialResolver {
  resolveForUse(workspaceId: WorkspaceId, id: CredentialId): Promise<ResolvedCredential>;
}

export const CREDENTIAL_RESOLVER = Symbol('CREDENTIAL_RESOLVER');

/**
 * The write side of a credential's health, so the provider layer can record a probe without
 * importing the credentials feature (which would close a module cycle).
 */
export interface CredentialStatusWriter {
  markUsed(workspaceId: WorkspaceId, id: CredentialId): Promise<unknown>;
  markError(workspaceId: WorkspaceId, id: CredentialId, code: ProviderErrorCode): Promise<unknown>;
}

export const CREDENTIAL_STATUS = Symbol('CREDENTIAL_STATUS');

/** Optional override of the per-call hard timeout in milliseconds (default 60 000). */
export const LLM_CALL_TIMEOUT_MS = Symbol('LLM_CALL_TIMEOUT_MS');

/** Optional override of the built-in models directory (default `apps/api/models`). */
export const LOCAL_MODELS_DIR = Symbol('LOCAL_MODELS_DIR');

/** What a provider factory gets besides the credential. */
export interface ProviderFactoryContext {
  /** `fetch` bound to `safeFetch` with the provider URL policy; pass it to every SDK provider. */
  fetch: typeof globalThis.fetch;
}

/** The model constructors of one provider instance; a provider omits the kinds it lacks. */
export interface ProviderModels {
  languageModel?: (modelId: string) => ChatModel;
  embeddingModel?: (modelId: string) => EmbeddingModel;
}

export type ProviderFactory = (
  credential: ResolvedCredential,
  context: ProviderFactoryContext,
) => ProviderModels;

export interface StreamChatRequest {
  /** Tenancy: credentials are always resolved within a workspace. */
  workspaceId: WorkspaceId;
  credentialId: CredentialId;
  model: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  temperature?: number;
  signal: AbortSignal;
  /** Only reviewed, enabled tools are supplied by the workspace tool registry. */
  tools?: Record<string, ProviderToolDefinition>;
  maxToolCalls?: number;
  maxSteps?: number;
  /** Requires a tool on the first model step, then allows a normal answer. */
  requireToolCall?: boolean;
}

/** SDK-neutral tool contract. AI SDK types stay inside the provider module. */
export interface ProviderToolDefinition {
  description: string;
  inputSchema: JSONSchema7;
  execute(input: unknown): Promise<unknown>;
}

export interface StreamChatFinal {
  inputTokens: number;
  outputTokens: number;
  ttftMs: number;
  /** Provider request body reported by the SDK, capped at 64 KB. */
  requestSnapshot: unknown;
  toolCalls?: { name: string; input: unknown; output: unknown }[];
}

export interface StreamChatResult {
  /** Text deltas; throws a `ProviderError` when the call fails. */
  textStream: AsyncIterable<string>;
  /** Rejects with a `ProviderError` when the call fails. */
  final: Promise<StreamChatFinal>;
  /** Usage from model steps that completed before a later step failed or was aborted. */
  usageSnapshot?(): { inputTokens: number; outputTokens: number };
}

/**
 * What the embedded texts are: a search `query` or a `document` chunk being indexed. Models
 * trained with asymmetric prefixes (multilingual-e5) embed the two differently.
 */
export type EmbedPurpose = 'query' | 'document';

export interface EmbedRequest {
  workspaceId: WorkspaceId;
  credentialId: CredentialId;
  model: string;
  inputs: string[];
  /** Defaults to `document`. Only the local provider uses it; others ignore it. */
  purpose?: EmbedPurpose;
  signal: AbortSignal;
}

export interface EmbedResult {
  vectors: number[][];
  tokens: number;
}
