---
title: FAQ
description: Frequently asked questions about self-hosting and using AiLoom
---

# Frequently Asked Questions

## General

### What is AiLoom?

AiLoom is a self-hosted AI customer support platform. An AI agent answers customers first, grounded in your own knowledge base, and escalates to a human team when it can't help. Everything runs from a single `docker compose up` with your own model keys or fully local models.

### Is AiLoom production-ready?

Not yet. AiLoom is pre-1.0 and under active development. APIs, configuration, and the database schema can change between `0.x` releases; breaking changes are listed under "Upgrade notes" in the changelog.

### What does it cost to run?

There is no platform fee. You pay only for the model provider APIs you use (or nothing if you use Ollama or the built-in local embedding model), plus the cost of hosting one server.

## Self-hosting

### What are the minimum host requirements?

2 vCPU / 4 GB RAM is recommended. A 2 GB host works if you disable the built-in local embeddings with `LOCAL_EMBEDDINGS=false` and use an external embedding provider.

### Do I need Redis or a separate vector database?

No. Phase 1 uses a single PostgreSQL 18 database with pgvector for vectors, pg-boss for background jobs, and LISTEN/NOTIFY for real-time updates. Redis is not required.

### Can I run it fully offline / with local models?

Yes. Ollama is supported via an optional compose profile (`--profile ollama`), and the built-in `bge-small-en-v1.5` embedding model runs in-process after its model files are downloaded once.

## Data and backups

### Where is data stored?

Everything lives in PostgreSQL (relational data, vectors, job queue). Uploaded files live on local disk under `/data` inside the `api` container (configurable via `STORAGE_DIR`).

### How do I back up and restore?

Use `deploy/scripts/backup.sh` and `deploy/scripts/restore.sh`. See [Backups and restore](/backups/), including the restore drill checklist.

### Is my data private?

Yes. You self-host, so your data and conversations never leave your infrastructure unless you configure an external model provider. Provider requests send message content to that provider's API — review their terms if that matters to you.

## AI and knowledge

### Which models can I use?

OpenAI, Anthropic, Google (Gemini), Groq, Mistral, Ollama, and generic OpenAI-compatible endpoints for chat. OpenAI, Google, Ollama, and the built-in local model support embeddings.

### Can I switch the embedding model after adding knowledge?

Yes. Changing a bot's `embedding_model` triggers a re-embed job (`pending_embedding_model`), then atomically swaps the current version. See [Architecture](/architecture/).

### Why did the AI say it doesn't know?

If no knowledge chunk passes the retrieval threshold, the bot answers with its configured `fallback_message` or offers a handoff to a human, depending on `no_answer_behavior`. Unanswered questions surface in the admin usage page so you can improve your knowledge base.

## Accounts and access

### What roles exist?

Owner, admin, and agent. Owners manage billing-level settings, members, and credentials. Admins manage bots, knowledge, and prompts. Agents handle conversations and handoffs. See the [permission matrix](https://github.com/li4nee/ailoom/blob/main/docs/spec.md#permission-matrix-phase-1) in the specification.

### Can I invite teammates?

Yes. Workspace owners and admins invite members by email; the invitee signs up through an email link.
