---
title: Providers
description: AI provider configuration and setup
---

# Providers

AiLoom supports multiple AI providers through the Vercel AI SDK (`ai` + `@ai-sdk/*`). All provider traffic goes through a single internal `Llm` service (ADR-003), so adding or swapping a provider touches one module.

## Supported providers

| Provider | Package | Chat | Embedding |
|----------|---------|------|-----------|
| OpenAI | `@ai-sdk/openai` | ✓ | ✓ |
| Anthropic | `@ai-sdk/anthropic` | ✓ | |
| Google | `@ai-sdk/google` | ✓ | ✓ |
| Groq | `@ai-sdk/groq` | ✓ | |
| Mistral | `@ai-sdk/mistral` | ✓ | |
| Ollama | `@ai-sdk/openai-compatible` | ✓ | ✓ |
| Local (built-in) | `@huggingface/transformers` | | ✓ |

## Configuration

Each provider is configured through `provider_credentials` in the database, linked to a bot. API keys are encrypted at rest.

## Coming in v0.1.0

- Per-provider setup guides (where to get API keys, rate limits, model lists)
- Local embedding model details (`bge-small-en-v1.5`, ADR-010)
