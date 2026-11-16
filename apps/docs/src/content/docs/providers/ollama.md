---
title: Ollama
description: Use self-hosted models through the OpenAI-compatible API
---

# Ollama

See [Ollama and local models](/self-hosting/ollama/) for starting the compose profile and
pulling a model.

Add a credential with provider **Ollama** and base URL `http://ollama:11434`. If Ollama
runs on the Docker host, use `http://host.docker.internal:11434`.

Ollama can provide chat and embeddings (`nomic-embed-text`). Model availability depends on
what you have pulled into the Ollama volume.
