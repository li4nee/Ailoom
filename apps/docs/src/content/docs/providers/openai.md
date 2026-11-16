---
title: OpenAI
description: Use OpenAI chat and embedding models
---

# OpenAI

1. Create an API key at <https://platform.openai.com/api-keys>.
2. In the admin, add a credential with provider **OpenAI** and paste the key.
3. Pick a chat model for the bot. `gpt-4o-mini` is the inexpensive default;
   `gpt-4o` and `gpt-4.1-mini` are also in the catalog.
4. For embeddings, choose `text-embedding-3-small` (1536 dimensions) or
   `text-embedding-3-large`.

Keys are encrypted at rest and never shown again. Usage and estimated cost appear on the
workspace usage page and in each trace.
