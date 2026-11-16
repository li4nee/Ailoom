---
title: Built-in local embeddings
description: Run bge-small-en-v1.5 in the API process
---

# Built-in local embeddings

No credential or API key is needed. When `LOCAL_EMBEDDINGS=true` (the default), the API runs
`bge-small-en-v1.5` through ONNX Runtime and every workspace gets a built-in local
credential automatically.

- `bge-small-en-v1.5`: 384 dimensions, English-focused, fast.
- `multilingual-e5-small`: 384 dimensions, better for non-English knowledge.

Set `LOCAL_EMBEDDING_MODEL` to change the default for **new** bots. Existing bots keep the
model they were created with; changing a bot's embedding model re-embeds its knowledge.

On hosts below 2 GB RAM set `LOCAL_EMBEDDINGS=false` and use a provider embedding model.

The model is downloaded into the model volume on first start (or baked into the image by
the Dockerfile). See [Ollama and local models](/self-hosting/ollama/).
