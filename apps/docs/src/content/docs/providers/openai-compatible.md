---
title: OpenAI-compatible endpoints
description: Connect vLLM, LiteLLM, OpenRouter, or another compatible gateway
---

# OpenAI-compatible endpoints

Use this provider for any service that implements the OpenAI chat-completions API, such as
vLLM, LiteLLM, OpenRouter, or an internal gateway.

Add a credential with provider **OpenAI-compatible**, a base URL (for example
`https://openrouter.ai/api/v1`), and an API key if the endpoint requires one.

Base URLs must be absolute HTTP(S) URLs without a query string or fragment. Private
addresses are blocked by default; see [Provider URL policy](/security/#provider-url-policy)
before pointing at an internal service.

Model names are passed through to the endpoint, so use the exact ID that gateway expects.
