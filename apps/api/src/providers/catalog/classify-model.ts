// SPDX-License-Identifier: AGPL-3.0-only

/** What a listed model can do; `skip` means the platform never offers it. */
export type ModelKind = 'chat' | 'embedding';

/** Embedding model families across providers (OpenAI, Ollama, BGE/E5, MiniLM, Nomic). */
const EMBEDDING = /embed|bge|e5-|minilm|nomic/i;

/** Models that are not a chat or embedding model (speech, images, moderation, realtime). */
const NOT_TEXT = /whisper|tts|dall-e|moderation|audio|realtime|transcribe|image|guard/i;

/**
 * Classifies a model id for providers whose model list carries no kind (OpenAI-compatible
 * endpoints, Ollama, OpenAI, Groq, Mistral). Gemini reports its own capabilities instead.
 */
export function classifyModelId(id: string): ModelKind | 'skip' {
  if (NOT_TEXT.test(id)) return 'skip';
  return EMBEDDING.test(id) ? 'embedding' : 'chat';
}
