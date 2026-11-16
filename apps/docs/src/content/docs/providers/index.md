---
title: Providers
description: AI provider configuration and setup
---

# Providers

AiLoom supports multiple AI providers through the Vercel AI SDK. Provider traffic goes
through a single internal `Llm` service, so bots can switch providers without changing the
rest of the stack.

| Provider          | Chat | Embeddings | Guide                                                 |
| ----------------- | ---- | ---------- | ----------------------------------------------------- |
| OpenAI            | ✓    | ✓          | [OpenAI](/providers/openai/)                          |
| Anthropic         | ✓    |            | [Anthropic](/providers/anthropic/)                    |
| Google Gemini     | ✓    | ✓          | [Gemini](/providers/gemini/)                          |
| Groq              | ✓    |            | [Groq](/providers/groq/)                              |
| Mistral           | ✓    | ✓          | [Mistral](/providers/mistral/)                        |
| Ollama            | ✓    | ✓          | [Ollama](/providers/ollama/)                          |
| OpenAI-compatible | ✓    | ✓          | [Compatible endpoints](/providers/openai-compatible/) |
| Built-in local    |      | ✓          | [Local embeddings](/providers/local/)                 |

## Credentials

Credentials live per workspace and can be shared by bots. API keys are encrypted at rest
with `ENCRYPTION_KEYS` and never shown again after saving. The admin can test a credential
before a bot uses it; failed tests return a normalized error code without the raw provider
body.

Each bot has a separate chat credential/model and embedding credential/model. That lets you
run Claude for chat with local embeddings, or OpenAI chat with a self-hosted embedder.
