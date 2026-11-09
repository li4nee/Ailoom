# Milestone 2 — Credentials and Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins store encrypted provider keys for all 7 providers (plus the built-in local model), test them, list models, see costs from a price table, and create fully configured bots with versioned instructions — in the API and the admin UI.

**Architecture:** spec §9.2, §11, §15.2, §17.4–17.5; architecture §4.8. Credentials are sealed with `SecretBox`; `CredentialsService` implements the `CredentialResolver` the `Llm` service already consumes; provider factories live in `providers/catalog/` and all receive `safeFetch` with `providerPolicy`.

**Tech Stack:** `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/groq`, `@ai-sdk/mistral`, `@ai-sdk/openai-compatible`, `big.js`, undici `MockAgent` for provider HTTP tests.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index: `2026-11-09-00-index.md`.

## Global Constraints

All index constraints apply. Milestone-specific:

- API responses never contain `secret_ciphertext`, `secret_iv`, `secret_tag`, or the decrypted key. The credential mapper has no field that could hold them.
- Model-list and test-connection errors returned to clients are normalized `ProviderErrorCode`s only (spec §11.3).
- Gemini and Anthropic keys travel in headers (`x-goog-api-key`, `x-api-key`), never in URLs.
- Money: `numeric` columns are read as strings and computed with `big.js`; never JavaScript floats.

## Review Focus (this milestone)

1. **Pasted keys with whitespace or a trailing newline.** Expected: trimmed before sealing; `secret_last4` reflects the trimmed key. → Task 2.1 test.
2. **Ollama base URL entered as `http://localhost:11434`** from inside Docker. Expected: test-connection fails with `connection_failed` and the UI shows the `host.docker.internal` hint. → Tasks 2.3, 2.11.
3. **Deleting a credential used by a soft-deleted bot.** Expected: allowed (soft-deleted bots don't count as "in use"). → Task 2.3 test.
4. **Allowed-origin patterns with paths or trailing slashes** (`https://shop.com/`, `https://shop.com/app`). Expected: trailing slash normalized away; paths rejected with a clear validation message. → Task 2.7 test.
5. **Price unknown for a custom Ollama/OpenAI-compatible model.** Expected: cost recorded as `0` with `priceKnown: false`, UI shows "price unknown", never a crash. → Task 2.5 test.

---

### Task 2.1: Credentials storage and resolution

**Files:**
- Create: `packages/shared/src/credentials.ts`
- Create: `apps/api/src/modules/credentials/{credentials.repository.ts,credentials.service.ts,credentials.mapper.ts,credentials.module.ts,index.ts}`
- Test: `apps/api/src/modules/credentials/credentials.service.int.spec.ts`

**Interfaces:**
- Consumes: `SecretBox` (0.10), `TenantRepository` (0.8), `CredentialResolver`, `ResolvedCredential`, `CREDENTIAL_RESOLVER` (0.13), `AuditService` (1.9).
- Produces:
  - shared: `createCredentialSchema` (discriminated on `provider`: `apiKey` required for openai/anthropic/gemini/groq/mistral, optional for openai_compatible, absent for ollama; `baseUrl` required for ollama/openai_compatible, must be `http(s)` URL without query/fragment; `label` 1–80 chars); `updateCredentialSchema` (`label?`, `apiKey?`, `baseUrl?`); `credentialDtoSchema` `{ id, provider, label, secretLast4, baseUrl, lastUsedAt, lastErrorAt, lastError, createdAt, updatedAt }`
  - `CredentialsService implements CredentialResolver`: `create(ws, input, actor)`, `update(ws, id, input, actor)`, `delete(ws, id, actor)` (`credential_in_use` 409), `list(ws)`, `get(ws, id)`, `resolveForUse(ws, id)`, `markUsed(ws, id)`, `markError(ws, id, code: ProviderErrorCode)`
  - Audit actions appended: `credential.created`, `credential.updated`, `credential.deleted`

- [ ] **Step 1: Write failing tests**

```ts
it('seals the trimmed key and stores last4', async () => {
  const c = await svc.create(ws, { provider: 'openai', label: 'Prod', apiKey: '  sk-abc1234\n' }, actor);
  expect(c.secretLast4).toBe('1234');
  const raw = (await ds.query('SELECT * FROM provider_credentials WHERE id=$1', [c.id]))[0];
  expect(JSON.stringify(raw)).not.toContain('sk-abc1234');
  expect((await svc.resolveForUse(ws, c.id)).apiKey).toBe('sk-abc1234');
});
it('dto never exposes secret fields', () => expect(Object.keys(toCredentialDto(entity))).not.toEqual(expect.arrayContaining(['secretCiphertext', 'apiKey'])));
it('resolveForUse is workspace-scoped', async () => expect(svc.resolveForUse(otherWs, c.id)).rejects.toMatchObject({ code: 'not_found' }));
it('ollama has no secret', async () => { const c = await svc.create(ws, { provider: 'ollama', label: 'L', baseUrl: 'http://ollama:11434' }, actor);
  expect((await svc.resolveForUse(ws, c.id)).apiKey).toBeNull(); });
it('updating the key re-seals with the active key version and bumps updatedAt', async () => { … });
it('audits without the secret', async () => { expect(JSON.stringify(await lastAudit())).not.toContain('sk-'); });
```

- [ ] **Step 2–4: Fail → implement → pass** (`pnpm --filter @app/api test:int -- src/modules/credentials`).
- [ ] **Step 5: Bind** `CREDENTIAL_RESOLVER` to `CredentialsService` in `HttpAppModule` and `WorkerAppModule`.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(credentials): encrypted provider credentials with resolution for the llm layer"`

---

### Task 2.2: Provider catalog — factories and model listing

**Files:**
- Create: `apps/api/src/providers/catalog/{index.ts,openai.ts,anthropic.ts,gemini.ts,groq.ts,mistral.ts,ollama.ts,openai-compatible.ts,classify-model.ts}`
- Modify: `apps/api/src/providers/registry.ts` (register the 7 factories)
- Test: `apps/api/src/providers/catalog/*.spec.ts`

**Interfaces:**
- Consumes: `ProviderRegistry.register`, `ProviderFactory` (0.13), `safeFetch`, `providerPolicy` (0.12).
- Produces:
  - `type ProviderFactory = { createLanguageModel(c: ResolvedCredential, modelId: string, fetch: typeof globalThis.fetch): LanguageModel; createEmbeddingModel: ((c, modelId, fetch) => EmbeddingModel<string>) | null; listModels(c: ResolvedCredential, fetch): Promise<{ id: string; kind: 'chat' | 'embedding' }[]> }`
  - `classifyModelId(id: string): 'chat' | 'embedding' | 'skip'` (embedding if `/embed|bge|e5-|minilm|nomic/i`; skip if `/whisper|tts|dall-e|moderation|audio|realtime|transcribe|image|guard/i`)
  - Factory details: openai → `createOpenAI({ apiKey, baseURL, fetch })`, list `GET {base}/v1/models`; anthropic → `createAnthropic`, list `GET https://api.anthropic.com/v1/models` (`x-api-key`, `anthropic-version: 2023-06-01`), no embeddings; gemini → `createGoogleGenerativeAI`, list `GET …/v1beta/models` (`x-goog-api-key`), kind from `supportedGenerationMethods` (`generateContent` → chat, `embedContent` → embedding), ids without the `models/` prefix; groq → `createGroq`, list `GET https://api.groq.com/openai/v1/models`, no embeddings; mistral → `createMistral`, list `GET https://api.mistral.ai/v1/models`; ollama → `createOpenAICompatible({ name: 'ollama', baseURL: base + '/v1', includeUsage: true, fetch })`, list `GET {base}/api/tags` (`models[].name`); openai_compatible → `createOpenAICompatible({ name: 'openai-compatible', baseURL: base, apiKey, includeUsage: true, fetch })`, list `GET {base}/models`.

- [ ] **Step 1: Write failing tests (one file per provider, undici `MockAgent`)**

```ts
it('lists OpenAI models, classifies and skips', async () => {
  mock.get('https://api.openai.com').intercept({ path: '/v1/models', headers: { authorization: 'Bearer sk-x' } })
    .reply(200, { data: [{ id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }] });
  expect(await openai.listModels(cred, fetch)).toEqual([{ id: 'gpt-4o-mini', kind: 'chat' }, { id: 'text-embedding-3-small', kind: 'embedding' }]);
});
it('sends the Gemini key in a header, not the URL', async () => { /* intercept asserts path has no "key=" and header x-goog-api-key present */ });
it('strips the models/ prefix for Gemini', async () => { … });
it('reads Ollama tags', async () => { … });
it('anthropic and groq have no embedding factory', () => { expect(anthropic.createEmbeddingModel).toBeNull(); expect(groq.createEmbeddingModel).toBeNull(); });
it('passes the injected fetch to the SDK', async () => { /* streamText on openai factory model hits MockAgent, proving the custom fetch is used */ });
it.each([['nomic-embed-text', 'embedding'], ['llama3.1:8b', 'chat'], ['whisper-large', 'skip']])('classify %s → %s', (id, k) => expect(classifyModelId(id)).toBe(k));
```

- [ ] **Step 2–4: Fail → implement → pass** (`pnpm --filter @app/api test:unit -- src/providers/catalog`).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(providers): catalog for openai, anthropic, gemini, groq, mistral, ollama and openai-compatible"`

---

### Task 2.3: `ProviderOps` and credential endpoints

**Files:**
- Create: `apps/api/src/providers/provider-ops.service.ts`, `apps/api/src/modules/credentials/credentials.controller.ts`
- Modify: `apps/api/test/isolation/isolation-fixtures.ts` (`credentialId`)
- Test: `apps/api/src/providers/provider-ops.service.spec.ts`, `apps/api/test/e2e/credentials.e2e.spec.ts`

**Interfaces:**
- Consumes: `ProviderRegistry`, `Llm`, `toProviderError`, `CredentialsService`.
- Produces:
  - `ProviderOps` per spec §11.3: `listModels(ws, credentialId)`, `testConnection(ws, credentialId)` (one-token completion with the first listed chat model, or one embedding for embedding-only providers; records `markUsed`/`markError`), `dimensions(ws, credentialId, model)` (from `models.json` if known — Task 2.5 — else embed `"dimension probe"` once, cache per `(credentialId, model)`)
  - Routes (spec §17.4, param `:credentialId`): `GET/POST /api/v1/workspaces/:workspaceId/credentials`, `PATCH/DELETE …/:credentialId`, `POST …/:credentialId/test` → `{ ok: true } | { ok: false, code: ProviderErrorCode, hint: string | null }`, `GET …/:credentialId/models`
  - Hints: `connection_failed` for a base URL host of `localhost`/`127.0.0.1` → `"Inside Docker, use http://host.docker.internal:11434 or the bundled ollama service (http://ollama:11434)."`; `blocked_url` → `"This address is blocked by the instance's provider URL policy (ALLOW_PRIVATE_PROVIDER_URLS / PROVIDER_URL_ALLOWLIST)."`

- [ ] **Step 1: Write failing tests**

```ts
it('admin creates, lists, tests and deletes a credential', async () => { … provider 'mock' credential allowed only when NODE_ENV!=production });
it('agents get 403 on credential routes', async () => { … });
it('test returns a normalized code and hint', async () => {
  const c = await create({ provider: 'ollama', label: 'L', baseUrl: 'http://localhost:11434' });
  expect((await post(`/credentials/${c.id}/test`)).body).toEqual({ ok: false, code: expect.stringMatching(/connection_failed|blocked_url/), hint: expect.any(String) });
});
it('rejects private base URLs when signup is open', async () => { /* config open → test → blocked_url */ });
it('blocks metadata addresses even when private URLs are allowed', async () => { … baseUrl http://169.254.169.254 → blocked_url });
it('409 when a live bot uses the credential', async () => { … credential_in_use });
it('allows deleting when only a soft-deleted bot used it', async () => { … });
it('never returns secrets in any response', async () => { const all = JSON.stringify([list.body, get.body, created.body]); expect(all).not.toContain('sk-test-secret'); });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Isolation** — add fixture `credentialId`; run `pnpm --filter @app/api test:e2e -- test/isolation` → PASS.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(credentials): crud, test-connection and model listing endpoints"`

---

### Task 2.4: Credential re-encryption job

**Files:**
- Create: `apps/api/src/modules/credentials/{reencrypt.job.ts,reencrypt.processor.ts}`, `apps/api/src/cli/credentials-reencrypt.ts`
- Test: `apps/api/src/modules/credentials/reencrypt.int.spec.ts`

**Interfaces:**
- Produces: job `credentials.reencrypt {}` (retryLimit 1, concurrency 1) that re-seals every row whose `key_version` ≠ active version in batches of 100; CLI `node dist/cli/credentials-reencrypt.js` enqueues it and prints `enqueued <jobId>`; documented in the self-hosting docs rotation section (Task 7.9).

- [ ] **Step 1: Write failing test** — seal 3 credentials with key v1, restart services with ring `[v2, v1]`, run job → all rows `key_version = 2`, all still decrypt to the same plaintext; with ring `[v2]` only afterwards → still decrypt.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(credentials): re-encryption job for master key rotation"`

---

### Task 2.5: Model catalog, prices, cost calculation

**Files:**
- Create: `apps/api/src/providers/data/{models.json,prices.json}`, `apps/api/src/modules/usage/{pricing.service.ts,model-prices.repository.ts,model-prices.controller.ts,usage.module.ts,index.ts}`, `packages/shared/src/usage.ts`
- Test: `apps/api/src/modules/usage/pricing.service.int.spec.ts`, `apps/api/test/e2e/model-prices.e2e.spec.ts`

**Interfaces:**
- Produces:
  - `models.json`: `{ "embedding": { "<provider>:<model>": { "dimensions": number, "threshold": number | null } }, "chat": { "<provider>:<model>": { "contextWindow": number } } }` with at least: `openai:text-embedding-3-small` (1536), `openai:text-embedding-3-large` (3072), `gemini:gemini-embedding-001` (3072), `gemini:text-embedding-004` (768), `mistral:mistral-embed` (1024), `ollama:nomic-embed-text` (768), `local:bge-small-en-v1.5` (384). Thresholds `null` until Task 4.11 calibrates them; `null` → default `0.35`.
  - `prices.json`: `{ "asOf": "YYYY-MM-DD", "prices": { "<provider>": { "<model>": { "input": number, "output": number } } } }` (USD per million tokens, from each provider's public pricing page on the day of implementation); `ollama`, `local`, `mock` → `0`.
  - `PricingService.price(ws: WorkspaceId, provider: ProviderKind, model: string): Promise<{ inputPerMtok: string; outputPerMtok: string; known: boolean }>` (workspace override → built-in → unknown = `0`, `known: false`; `ollama`/`local`/`mock` known zero)
  - `PricingService.cost(ws, u: { chat?: { provider; model; inputTokens; outputTokens }; embedding?: { provider; model; tokens } }): Promise<{ costUsd: string; priceKnown: boolean }>` (6 decimal places)
  - `ModelCatalog.embedding(provider, model): { dimensions: number; threshold: number } | null`, `ModelCatalog.defaultThreshold = 0.35`
  - Routes: `GET /api/v1/workspaces/:workspaceId/model-prices` (admin; built-ins merged with overrides, each flagged `source: 'builtin' | 'override'`), `PUT /api/v1/workspaces/:workspaceId/model-prices` (admin; replaces the workspace's overrides with the body list)

- [ ] **Step 1: Write failing tests**

```ts
it('computes exact cost', async () => { // openai gpt-4o-mini fixture price 0.15 / 0.60
  expect(await pricing.cost(ws, { chat: { provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 500 } }))
    .toEqual({ costUsd: '0.000450', priceKnown: true });
});
it('workspace overrides win', async () => { … });
it('unknown models cost 0 and are flagged', async () =>
  expect(await pricing.cost(ws, { chat: { provider: 'openai_compatible', model: 'my-llm', inputTokens: 10, outputTokens: 10 } })).toEqual({ costUsd: '0.000000', priceKnown: false }));
it('ollama is free and known', async () => { … priceKnown true });
it('prices.json and models.json validate against their schemas', () => { … });
it('PUT replaces overrides; agents get 403', async () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(usage): built-in model catalog, price table and workspace price overrides"`

---

### Task 2.6: Built-in local credential per workspace

**Files:**
- Create: `apps/api/src/modules/credentials/local-credential.listener.ts`, migration `<ts>-backfill-local-credentials.ts`
- Test: `apps/api/src/modules/credentials/local-credential.int.spec.ts`

**Interfaces:**
- Produces: on `workspace.created` (event from Task 1.10) insert one credential `{ provider: 'local', label: 'Built-in (local)', secret null }` when `config.localEmbeddings`; `CredentialsService.getLocal(ws): Promise<ProviderCredentialEntity | null>`; local credentials cannot be deleted or edited (`409 credential_builtin`); backfill migration inserts it for existing workspaces.

- [ ] **Step 1: Write failing tests** — new workspace has exactly one `local` credential; delete/patch → 409 `credential_builtin`; with `LOCAL_EMBEDDINGS=false` none is created; `listModels` on it returns `[{ id: 'bge-small-en-v1.5', kind: 'embedding' }]`.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(credentials): built-in local embedding credential per workspace"`

---

### Task 2.7: Bot domain — origins, defaults, schemas

**Files:**
- Create: `packages/shared/src/bots.ts`, `apps/api/src/modules/bots/domain/{origin-matcher.ts,bot-defaults.ts,contrast.ts}`
- Test: `apps/api/src/modules/bots/domain/*.spec.ts`

**Interfaces:**
- Produces:
  - `normalizeOriginPattern(p: string): string` (lowercase scheme+host, strips default port and trailing `/`; throws `AppError('validation_failed')` with message `"Origins cannot contain a path"` / `"Use https://*.example.com for subdomains"`)
  - `matchesAllowedOrigin(origin: string | null, patterns: string[]): boolean`
  - `BOT_DEFAULTS` = `{ allowedOrigins: [], noAnswerBehavior: 'offer_handoff', handoffEnabled: true, retrievalThreshold: null /* catalog default */, temperature: 0.2, maxOutputTokens: 600, monthlySpendCapUsd: null, requireChallenge: false, allowedLinkDomains: [], handoffPhrases: null, fallbackMessage: "I couldn't find that in our help content. Would you like to talk to a person?", handoffMessage: "Thanks — our team will reply here, and by email if you leave one.", appearance: { displayName: 'Support', themeColor: '#2563eb', position: 'right', welcomeMessage: 'Hi! How can I help?', avatarUrl: null, privacyUrl: null } }` (stored per bot at creation; editable)
  - `contrastText(hex: string): '#000000' | '#ffffff'` (WCAG relative luminance; picks the higher contrast)
  - shared schemas `createBotSchema`, `updateBotSchema`, `botDtoSchema`, `appearanceSchema` (`themeColor` `#rrggbb`, `avatarUrl`/`privacyUrl` https only, `welcomeMessage` ≤ 500, `displayName` ≤ 60), limits `fallbackMessage`/`handoffMessage` ≤ 1000, `handoffPhrases` ≤ 50 items of 2–60 chars, `allowedOrigins` ≤ 50, `temperature` 0–1, `maxOutputTokens` 64–4000, `retrievalThreshold` 0–1, `monthlySpendCapUsd` ≥ 0

- [ ] **Step 1: Write failing tests**

```ts
it.each([
  ['https://shop.com', ['https://shop.com'], true], ['https://shop.com:443', ['https://shop.com'], true],
  ['http://shop.com', ['https://shop.com'], false], ['https://a.shop.com', ['https://*.shop.com'], true],
  ['https://a.b.shop.com', ['https://*.shop.com'], true], ['https://shop.com', ['https://*.shop.com'], false],
  ['https://evilshop.com', ['https://*.shop.com'], false], ['http://localhost:3000', ['http://localhost:3000'], true],
  ['http://localhost:3001', ['http://localhost:3000'], false], ['null', ['https://shop.com'], false], [null, ['https://shop.com'], false],
])('%s vs %j → %s', (o, p, r) => expect(matchesAllowedOrigin(o, p)).toBe(r));
it('normalizes trailing slash and case', () => expect(normalizeOriginPattern('HTTPS://Shop.com/')).toBe('https://shop.com'));
it.each(['https://shop.com/app', '*', 'https://*', 'ftp://x.com', 'https://shop.com?x=1'])('rejects %s', p => expect(() => normalizeOriginPattern(p)).toThrow());
it.each([['#ffffff', '#000000'], ['#000000', '#ffffff'], ['#2563eb', '#ffffff'], ['#facc15', '#000000']])('contrastText(%s)', (bg, fg) => expect(contrastText(bg)).toBe(fg));
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(bots): origin matching, defaults and contrast helpers"`

---

### Task 2.8: Bots API

**Files:**
- Create: `apps/api/src/modules/bots/{bots.controller.ts,bots.service.ts,bots.repository.ts,bots.mapper.ts,bots.module.ts,index.ts}`, migration `<ts>-bots-generation-settings.ts`
- Modify: `apps/api/test/isolation/isolation-fixtures.ts` (`botId`), `docs/spec.md` §9.2 (add `temperature real default 0.2`, `max_output_tokens int default 600` rows)
- Test: `apps/api/test/e2e/bots.e2e.spec.ts`

**Interfaces:**
- Consumes: `CredentialsService`, `ProviderOps.dimensions`, `ModelCatalog`, `newPublicKey`, `AuditService`.
- Produces:
  - Routes (spec §17.5): `GET/POST /api/v1/workspaces/:workspaceId/bots`, `GET/PATCH/DELETE …/bots/:botId`, `POST …/bots/:botId/rotate-key`
  - `BotsService.create(ws, input, actor)` — validates the chat credential supports chat and the embedding credential supports embeddings (`embeddings_not_supported` 400 for anthropic/groq), resolves `embeddingDim`, defaults embedding to the workspace `local` credential + `bge-small-en-v1.5`
  - `BotsService.update(ws, botId, patch, actor)` — changing `embeddingModel`/`embeddingCredentialId` when the bot has zero chunks updates directly; when it has chunks, returns `409 reembed_not_available` (replaced by the re-embed flow in Task 3.10)
  - `BotsService.getForWidget(publicKey: string): Promise<BotEntity | null>` (non-deleted only) — used in Milestone 5
  - Soft delete sets `deleted_at` (knowledge purge added in Task 3.11)
  - Audit: `bot.created`, `bot.updated` (metadata = changed field names only), `bot.key_rotated`, `bot.deleted`

- [ ] **Step 1: Write failing tests**

```ts
it('creates a bot with defaults, pk_live key and local embeddings', async () => {
  const b = (await post('/bots', { name: 'Help', chatCredentialId: mockCred, chatModel: 'mock-chat' })).body;
  expect(b).toMatchObject({ publicKey: expect.stringMatching(/^pk_live_/), allowedOrigins: [], embeddingModel: 'bge-small-en-v1.5', embeddingDim: 384,
    noAnswerBehavior: 'offer_handoff', temperature: 0.2, maxOutputTokens: 600 });
});
it('rejects an embedding credential that cannot embed', async () => { anthropic cred as embedding → 400 embeddings_not_supported });
it('rejects a credential from another workspace', async () => { … 404 not_found });
it('normalizes origins on update', async () => { … ['https://shop.com/'] → ['https://shop.com'] });
it('rotating the key invalidates the old one', async () => { … getForWidget(old) null, new works });
it('agents can read but not change bots', async () => { … });
it('soft-deleted bots disappear from lists and widget lookup', async () => { … });
it('changing the embedding model with no knowledge updates dimensions', async () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Isolation** — fixture `botId`; isolation suite PASS.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(bots): bot crud, key rotation and model validation"`

---

### Task 2.9: Prompt versions

**Files:**
- Create: `apps/api/src/modules/prompts/{prompts.controller.ts,prompts.service.ts,prompt-versions.repository.ts,prompts.mapper.ts,prompts.module.ts,index.ts}`, `packages/shared/src/prompts.ts`
- Test: `apps/api/test/e2e/prompts.e2e.spec.ts`

**Interfaces:**
- Produces: routes `GET/POST /api/v1/workspaces/:workspaceId/bots/:botId/prompt-versions` (admin); `PromptsService.create(ws, botId, { systemPrompt: string (≤ 8000 chars); note?: string (≤ 200) }, actor)` inserts `version = max + 1` and points `bots.active_prompt_version_id` at it in one transaction; `PromptsService.getActive(ws, botId): Promise<PromptVersionEntity | null>`; audit `bot.prompt_updated` (metadata `{ version }`). New bots get version 1 with an empty `systemPrompt`.

- [ ] **Step 1: Write failing tests** — versions increment 1, 2, 3; the bot points at the latest; rows are immutable (no PATCH/DELETE routes exist: `listRoutes` contains none); two concurrent creates produce versions 2 and 3, never a duplicate (`SELECT … FOR UPDATE` on the bot row); 8001-char prompt → 400.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(prompts): immutable prompt versions with activation"`

---

### Task 2.10: Live provider contract workflow

**Files:**
- Create: `apps/api/src/providers/__contract__/live.contract.spec.ts`, `.github/workflows/live-providers.yml`

**Interfaces:**
- Consumes: `runChatContract`, `runEmbeddingContract` (0.15), catalog (2.2).

- [ ] **Step 1: Write the live spec** — for each provider whose env var is set (`LIVE_OPENAI_KEY`, `LIVE_ANTHROPIC_KEY`, `LIVE_GEMINI_KEY`, `LIVE_GROQ_KEY`, `LIVE_MISTRAL_KEY`, `LIVE_OLLAMA_URL`, `LIVE_OPENAI_COMPAT_URL` + `LIVE_OPENAI_COMPAT_KEY`) run the chat contract with a small model from `LIVE_<P>_CHAT_MODEL` and, where supported, the embedding contract; also assert `listModels` returns at least one chat model and a bad key maps to `auth_failed`. Skipped providers are reported with `it.skip` and the reason.
- [ ] **Step 2: Workflow** — `workflow_dispatch` only; secrets mapped to env; `ollama` service container pulling a tiny model (`qwen2.5:0.5b`, `nomic-embed-text`); runs `pnpm --filter @app/api exec vitest run src/providers/__contract__/live.contract.spec.ts`.
- [ ] **Step 3: Run once manually** with the owner's keys → all configured providers PASS; record the run link in the PR.
- [ ] **Step 4: Commit** — `git commit -s -m "ci: manual live provider contract workflow"`

---

### Task 2.11: Admin — credentials page

**Files:**
- Create: `apps/admin/src/routes/_app/w/$workspaceId/settings/credentials.tsx`, `apps/admin/src/features/credentials/{api.ts,components/{credential-list.tsx,credential-form.tsx,test-button.tsx}}`
- Test: `apps/admin/src/features/credentials/*.spec.tsx`

**Interfaces:**
- Produces: hooks `useCredentials(ws)`, `useCreateCredential`, `useUpdateCredential`, `useDeleteCredential`, `useTestCredential`, `useModels(ws, credentialId)`.

- [ ] **Step 1: Write failing component tests** — the form shows `API key` only for key-based providers and `Base URL` only for ollama/openai_compatible; the key field is `type="password"` with `autocomplete="off"` and is never pre-filled on edit (placeholder `•••• last4`); "Test" shows success or the error code's text plus the `hint`; deleting an in-use credential shows `strings.credentials.inUse`; the built-in local credential shows a "Built-in" badge and no edit/delete actions; each provider row links to its docs page `/docs/providers/<provider>`.
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): provider credentials page with test connection"`

---

### Task 2.12: Admin — bots list, settings tabs, install snippet

**Files:**
- Create: `apps/admin/src/routes/_app/w/$workspaceId/bots/{index.tsx,new.tsx,$botId/{route.tsx,general.tsx,model.tsx,appearance.tsx,behavior.tsx,instructions.tsx,install.tsx}}`, `apps/admin/src/features/bots/{api.ts,components/*}`
- Test: `apps/admin/src/features/bots/*.spec.tsx`

**Interfaces:**
- Produces: hooks `useBots`, `useBot`, `useCreateBot`, `useUpdateBot`, `useRotateKey`, `usePromptVersions`, `useCreatePromptVersion`; `buildEmbedSnippet(publicUrl: string, publicKey: string, opts?: { position?: 'left' | 'right'; open?: boolean; locale?: string }): string` producing exactly the spec §16.1 snippet.

- [ ] **Step 1: Write failing tests**

```ts
it('builds the spec snippet', () => expect(buildEmbedSnippet('https://support.example.com', 'pk_live_abc')).toBe(
  '<script\n  src="https://support.example.com/widget.js"\n  data-key="pk_live_abc"\n  async\n></script>'));
```
Component tests: create flow picks a chat credential then a model from `useModels` (chat models only); Appearance shows a live preview whose text color equals `contrastText(themeColor)`; Behavior form validates `allowedOrigins` client-side with the same messages as the API; Install tab warns "Widget is disabled until you add an allowed origin" when `allowedOrigins` is empty; Instructions tab lists versions newest first and saving creates a new version; rotating the key asks for confirmation and shows the new snippet; agents see read-only forms.

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit and tag**

```bash
git add -A
git commit -s -m "feat(admin): bots list, settings tabs, prompt versions and install snippet"
git tag m2-done
```
