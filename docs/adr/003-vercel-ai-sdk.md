# ADR-003: Vercel AI SDK for model calls; no LangChain or LangGraph

Date: 2026-11-09

Status: Accepted

## Context

The application needs to call multiple AI model providers (OpenAI, Anthropic, Google, Groq, Mistral, Ollama) with streaming, usage tracking, and error handling. Options included the Vercel AI SDK, LangChain, and LangGraph.

## Decision

Use the Vercel AI SDK (`ai` + `@ai-sdk/*` provider packages) behind one internal `Llm` service. Do not use LangChain or LangGraph in Phase 1.

## Consequences

- **Positive:** One streaming, usage, and error model across all providers, with maintained provider packages. Prompts, retrieval, and the wire protocol remain under our control, which keeps answer replay exact (we build every message) and token/cost accounting direct. All `ai` imports are confined to the `Llm` service, so a future swap touches one module.
- **Negative:** LangChain's prompt, chain, and vector-store abstractions are not used, which means some ecosystem integrations are unavailable. LangGraph is **revisited at Phase 3 only** if agents need stateful, resumable, multi-step workflows; a plain tool-call loop is built on AI SDK tools.
