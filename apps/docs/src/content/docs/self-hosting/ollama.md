---
title: Ollama and local models
description: Run chat and embeddings without an external provider
---

# Ollama and local models

AiLoom can run fully offline: Ollama provides chat, and the built-in ONNX model provides
embeddings.

## Start Ollama with the stack

```bash
docker compose -f deploy/docker-compose.yml --env-file .env \
  --profile ollama up -d --build --wait
```

Ollama is reachable inside the compose network at `http://ollama:11434`; it is not
published to the host. Pull a model into the container:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env \
  exec ollama ollama pull llama3.2
```

Create an **Ollama** credential in the admin with base URL `http://ollama:11434`, then pick
an Ollama chat model for the bot. `nomic-embed-text` is available as an Ollama embedding
model if you prefer it over the built-in embedder.

## Built-in embeddings

`LOCAL_EMBEDDINGS=true` (the default) runs `bge-small-en-v1.5` in the API process. The model
files are downloaded into the model volume on first use, or baked into the image at build
time by the Dockerfile. Choose `multilingual-e5-small` with `LOCAL_EMBEDDING_MODEL` for
non-English knowledge bases.

On hosts below 2 GB RAM set `LOCAL_EMBEDDINGS=false` and configure an external embedding
provider such as OpenAI or Gemini. A bot's embedding model is fixed when knowledge is
ingested; changing it triggers a re-embed.

## Host networking

Inside Docker, use `http://ollama:11434`, not `localhost`. If Ollama runs on the host
instead, use `http://host.docker.internal:11434` (the compose services already declare the
`host-gateway` mapping). Private provider addresses are blocked by default; see
[Provider URL policy](/security/#provider-url-policy).
