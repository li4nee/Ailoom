# ADR-010: Built-in local embedding model

Date: 2026-11-09

Status: Accepted

## Context

The knowledge base needs embedding generation for semantic search. Options included provider embeddings (OpenAI, etc.) and a built-in local model.

## Decision

Bake two small ONNX models into the API image and run them in-process via `@huggingface/transformers`: `bge-small-en-v1.5` (English, default) and `multilingual-e5-small` (~100 languages), both 384 dims and MIT, fetched at a pinned revision with SHA-256 checks. `LOCAL_EMBEDDING_MODEL` picks the default for new bots; both stay available to every bot.

## Consequences

- **Positive:** A fresh install with only a chat key (or no key, with Ollama) has working retrieval with no network download at runtime. Operators can switch any bot to a provider embedding model.
- **Negative:** ~130 MB RAM per process per loaded model, and ~160 MB of model files in the image. The model is loaded lazily on first use and kept warm.
