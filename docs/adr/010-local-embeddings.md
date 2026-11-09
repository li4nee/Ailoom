# ADR-010: Built-in local embedding model

Date: 2026-11-09

Status: Accepted

## Context

The knowledge base needs embedding generation for semantic search. Options included provider embeddings (OpenAI, etc.) and a built-in local model.

## Decision

Bake a small ONNX model (`bge-small-en-v1.5`, 384 dims, MIT) into the API image and run it in-process via `@huggingface/transformers`.

## Consequences

- **Positive:** A fresh install with only a chat key (or no key, with Ollama) has working retrieval with no network download at runtime. Operators can switch any bot to a provider embedding model.
- **Negative:** ~130 MB RAM per process for the model. The model is loaded lazily on first use and kept warm.
