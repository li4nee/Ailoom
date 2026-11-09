# Milestone 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An empty folder becomes a licensed, linted, CI-checked monorepo whose `docker compose up` serves health endpoints over Caddy, with the full database schema, common security libraries, the LLM layer (mock + local models), and the job queue in place.

**Architecture:** See `docs/architecture.md` §3, §4, §6, §7. This milestone builds the layers `common` → `db` → `providers` → `jobs` from the module map, plus repo tooling.

**Tech Stack:** pnpm 10, Turborepo 2, TypeScript, NestJS 11 + Fastify, TypeORM 0.3.x, pg, Zod 4, nestjs-pino, nestjs-cls, Vercel AI SDK, @huggingface/transformers, pg-boss, Vitest + unplugin-swc, Testcontainers, dependency-cruiser, Docker, Caddy 2, Astro Starlight.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index and shared names: `2026-11-09-00-index.md`.

## Global Constraints

All constraints in the index apply. Milestone-specific:

- Toolchain for decorators: SWC everywhere (Nest CLI `-b swc`, `unplugin-swc` in Vitest, `@swc-node/register` for the TypeORM CLI). No `ts-node`, no `tsx` for api code (esbuild drops decorator metadata).
- `apps/api` compiles to CommonJS (`"type": "commonjs"`, `module: nodenext`). ESM-only dependencies are loaded with plain `require`/`import` (Node 24 `require(esm)`).
- Files under `apps/api/models/` are gitignored and fetched by `pnpm --filter @app/api fetch-model` with SHA-256 verification.

## Review Focus (this milestone)

1. **Config typo at boot** (e.g. `SIGNUP_MODE=Invite`). Expected: process exits non-zero listing the variable, allowed values, and every other problem in one message. → Task 0.5 test `reports every invalid variable at once`.
2. **IPv6-mapped and decimal IP forms** (`::ffff:127.0.0.1`, `http://2130706433/`, `http://0x7f.1/`). Expected: blocked as loopback. → Task 0.12 tests.
3. **DNS that answers public first, private on second lookup** (rebinding). Expected: connection goes to the first resolved IP only. → Task 0.12 test `connects to the pinned address`.
4. **A migration added without an entity change, or vice versa.** Expected: `db:check` fails CI. → Task 0.6 verification + Task 0.19 CI job.
5. **Local model files missing at runtime** (operator built image without models). Expected: `/api/health/ready` stays 200 but diagnostics reports `localModel: missing`, and creating a bot with the local embedding model fails with `local_model_unavailable`, not a crash. → Task 0.14 test.

---

### Task 0.1: Monorepo scaffold

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`, `.gitignore`, `.gitattributes`, `.editorconfig`
- Create: `packages/tsconfig/{package.json,base.json,node.json,react.json}`
- Create: `apps/api/{package.json,tsconfig.json,src/main.ts}`, `apps/admin/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx}`, `apps/docs/package.json`, `packages/{shared,widget,eslint-config}/{package.json,tsconfig.json,src/index.ts}`

**Interfaces:**

- Produces: root scripts `build`, `dev`, `lint`, `typecheck`, `test`, `format`, `format:check`; workspace package names from the index.

- [ ] **Step 1: Initialize git**

Run: `git init -b main`
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Write root files**

`package.json`: `"private": true`, `"packageManager": "pnpm@10.<latest>"`, `"engines": { "node": ">=24 <25" }`, scripts delegating to `turbo run <task>`; `format`/`format:check` call Prettier (installed in 0.4).
`pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
`.nvmrc`: `24`. `.npmrc`: `engine-strict=true`.
`.gitignore`: `node_modules`, `dist`, `.turbo`, `coverage`, `.env`, `apps/api/models/*` (keep `!apps/api/models/manifest.json`), `playwright-report`, `test-results`.
`.gitattributes`: `* text=auto eol=lf`.
`.editorconfig`: 2-space indent, LF, final newline, utf-8.

- [ ] **Step 3: Write `turbo.json`**

Tasks: `build` (`dependsOn: ["^build"]`, `outputs: ["dist/**"]`), `typecheck` (`dependsOn: ["^build"]`), `lint` (`dependsOn: ["^build"]`), `test` (`dependsOn: ["^build"]`), `dev` (`cache: false`, `persistent: true`).

- [ ] **Step 4: Write `packages/tsconfig`**

`base.json` = exactly the compilerOptions in architecture §7.1. `node.json` extends base: `module`/`moduleResolution` `nodenext`, `target` `es2023`, `experimentalDecorators`, `emitDecoratorMetadata`, `outDir` `dist`, `declaration` true. `react.json` extends base: `module` `esnext`, `moduleResolution` `bundler`, `jsx` `react-jsx`, `lib` `["dom","dom.iterable","es2023"]`, `noEmit` true.

- [ ] **Step 5: Write workspace packages**

Each `package.json` has `name`, `version: "0.0.0"`, `private: true`, `license` (`AGPL-3.0-only` for apps, `MIT` for packages), `scripts.typecheck: "tsc --noEmit"`. Each `src/index.ts` contains `export {};`. `apps/admin` is a minimal Vite React app: `index.html` with `<div id="root">`, `src/main.tsx` rendering the text `Admin`; scripts `dev`, `build` (`vite build`).

- [ ] **Step 6: Install and verify**

Run: `pnpm install && pnpm typecheck && pnpm --filter @app/admin build`
Expected: 7 packages typecheck with 0 errors; `apps/admin/dist/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -s -m "chore: scaffold pnpm + turborepo monorepo"
```

---

### Task 0.2: Licensing and community files

**Files:**

- Create: `LICENSE`, `LICENSES/{AGPL-3.0-only,MIT,CC-BY-4.0}.txt`, `REUSE.toml`, `LICENSING.md`, `packages/{shared,widget,eslint-config,tsconfig}/LICENSE`
- Create: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, `SUPPORT.md`, `CHANGELOG.md`

- [ ] **Step 1: Download license texts**

Run: `pipx run reuse download AGPL-3.0-only MIT CC-BY-4.0 && cp LICENSES/AGPL-3.0-only.txt LICENSE`
Expected: three files in `LICENSES/`, `LICENSE` identical to the AGPL text.

- [ ] **Step 2: MIT package licenses**

Each MIT package `LICENSE` = MIT text with `Copyright (c) 2026 <COPYRIGHT HOLDER>`.

- [ ] **Step 3: Write `REUSE.toml`**

`version = 1`. Annotations in this order (REUSE applies the **last** matching annotation):

1. `path = ["**"]`, `SPDX-FileCopyrightText = "2026 <COPYRIGHT HOLDER>"`, `SPDX-License-Identifier = "AGPL-3.0-only"`, `precedence = "aggregate"`.
2. `path = ["packages/**"]`, `SPDX-License-Identifier = "MIT"`, `precedence = "aggregate"`.
3. `path = ["apps/docs/src/content/**"]`, `SPDX-License-Identifier = "CC-BY-4.0"`, `precedence = "aggregate"`.

- [ ] **Step 4: Write `LICENSING.md`**

Contents: the table from architecture §6.1 and this sentence verbatim from spec §24: "embedding the widget or using the SDKs in your own product never makes your product AGPL; modifying and hosting the server for others means sharing your server changes."

- [ ] **Step 5: Write community files**

- `README.md`: name, one-line pitch (spec §1 positioning line), "pre-1.0, not production-ready yet" status, license badges, links to `docs/`. Quick start and GIF come in Task 7.10.
- `CONTRIBUTING.md`: prerequisites (Node 24, pnpm 10, Docker), setup commands, Conventional Commits + `git commit -s`, test commands from the index, links to architecture §7 and §8.
- `SECURITY.md`: report via GitHub private vulnerability reporting or `<SECURITY EMAIL>`; acknowledgement within 3 business days; 90-day disclosure; supported versions = latest minor.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1 text, contact `<SECURITY EMAIL>`.
- `GOVERNANCE.md`, `SUPPORT.md`: content from architecture §6.2.
- `CHANGELOG.md`: `# Changelog` (release-please maintains it from Task 7.8).

- [ ] **Step 6: Verify REUSE compliance**

Run: `pipx run reuse lint`
Expected: `Congratulations! Your project is compliant with version 3.x of the REUSE Specification :-)`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -s -m "docs: add licenses, REUSE metadata, and community files"
```

---

### Task 0.3: ESLint config package with custom rules

**Files:**

- Create: `packages/eslint-config/src/{index.ts,plugin.ts}`
- Create: `packages/eslint-config/src/rules/{tenant-repository.ts,no-process-env.ts,spdx-header.ts,no-agpl-import.ts}`
- Test: `packages/eslint-config/test/rules/*.spec.ts`, fixtures in `packages/eslint-config/test/fixtures/`
- Create: `eslint.config.ts` in every workspace package

**Interfaces:**

- Produces: `createConfig(opts: { tsconfigRootDir: string; license: 'AGPL-3.0-only' | 'MIT' | 'CC-BY-4.0'; react?: boolean; processEnvAllow?: string[]; forbiddenImports?: string[] }): Linter.Config[]`; plugin namespace `local` with rules `local/tenant-repository`, `local/no-process-env`, `local/spdx-header`, `local/no-agpl-import`.

- [ ] **Step 1: Write failing tests for `spdx-header`**

```ts
ruleTester.run('spdx-header', spdxHeader, {
  valid: [{ code: '// SPDX-License-Identifier: MIT\nexport {};', options: [{ license: 'MIT' }] }],
  invalid: [
    {
      code: 'export {};',
      options: [{ license: 'MIT' }],
      errors: [{ messageId: 'missingHeader' }],
      output: '// SPDX-License-Identifier: MIT\nexport {};',
    },
    {
      code: '// SPDX-License-Identifier: AGPL-3.0-only\nexport {};',
      options: [{ license: 'MIT' }],
      errors: [{ messageId: 'wrongLicense' }],
    },
  ],
});
```

- [ ] **Step 2: Write failing tests for `no-process-env`**

Valid: `process.env.X` in filename `src/common/config/load-config.ts` and in `src/main.ts` with `options: [{ allow: ['src/common/config/**', 'src/main.ts', 'src/worker.ts', 'src/migrate.ts', 'src/cli/**', 'src/db/cli-data-source.ts'] }]`. Invalid: same code in `src/modules/bots/bots.service.ts` → `messageId: 'noProcessEnv'`; destructuring `const { env } = process` → `noProcessEnv`.

- [ ] **Step 3: Write failing tests for `no-agpl-import`**

Options `[{ forbidden: ['@app/api', '@app/admin'], forbiddenPathSegments: ['/apps/'] }]`. Invalid: `import x from '@app/api/src/x'`, `import x from '../../../apps/api/src/x'`, `export * from '@app/admin'` → `agplImport`. Valid: `import { z } from 'zod'`, `import x from '@app/shared'`.

- [ ] **Step 4: Write failing tests for `tenant-repository` (typed rule)**

Fixture `test/fixtures/tenant/entities.ts` declares `class BotEntity { id!: string; workspaceId!: string }`, `class UserEntity { id!: string }`, and a minimal `Repository<T>` type with `findOne`, `findOneBy`, `find`, `findBy`, `update`, `delete`, `save`, `remove`, `count`. Invalid: in `bots.service.ts`, `declare const repo: Repository<BotEntity>; repo.findOneBy({ id: '1' });` → `tenantRepositoryOnly`. Valid: the same code in `bots.repository.ts`; `Repository<UserEntity>` in `users.service.ts`.

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm --filter @app/eslint-config test`
Expected: FAIL, rules not found.

- [ ] **Step 6: Implement the four rules**

- `spdx-header`: checks the first comment of the file; autofix inserts `// SPDX-License-Identifier: <license>\n` at position 0.
- `no-process-env`: reports `MemberExpression` `process.env` and destructuring of `env` from `process`, unless the file path (relative to cwd) matches an `allow` glob (`picomatch`).
- `no-agpl-import`: checks `ImportDeclaration`, `ExportAllDeclaration`, `ExportNamedDeclaration` with source, and `ImportExpression` string literals.
- `tenant-repository`: uses `parserServices.program.getTypeChecker()`; on `CallExpression` whose callee is `X.<method>` with method in the banned list, resolves the type of `X`; if it is `Repository<T>` and `T` has a property named `workspaceId`, reports unless the filename ends with `.repository.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @app/eslint-config test`
Expected: PASS, 4 rule suites.

- [ ] **Step 8: Implement `createConfig`**

Composition: `@eslint/js` recommended, `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` with `parserOptions.projectService: true`, `eslint-plugin-import-x` (`no-cycle`, `order`), `eslint-plugin-unicorn` (rules: `prefer-node-protocol`, `no-array-for-each`, `prefer-string-slice`, `throw-new-error`), `eslint-plugin-vitest` for `*.spec.ts`, and when `react`: `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`. Always on: `no-console: error`, `eqeqeq: error`, `@typescript-eslint/switch-exhaustiveness-check: error`, `@typescript-eslint/no-non-null-assertion: error` (off in `*.spec.ts`), `no-restricted-syntax` banning `dangerouslySetInnerHTML` and `innerHTML` assignment, plus the four `local/*` rules wired from options.

- [ ] **Step 9: Add `eslint.config.ts` to every package and verify**

api: `license: 'AGPL-3.0-only'`, `processEnvAllow` as in Step 2. admin: `react: true`, AGPL. widget/shared/tsconfig/eslint-config: `MIT`, `forbiddenImports: ['@app/api','@app/admin']`.
Run: `pnpm lint`
Expected: PASS after `pnpm lint -- --fix` adds SPDX headers to existing files.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -s -m "feat(eslint-config): shared flat config with tenant, env, spdx and license-boundary rules"
```

---

### Task 0.4: Formatting, git hooks, commit linting

**Files:**

- Create: `.prettierrc`, `.prettierignore`, `lefthook.yml`, `commitlint.config.ts`, `scripts/check-signoff.mjs`

- [ ] **Step 1: Write configs**

`.prettierrc`: `{ "singleQuote": true, "trailingComma": "all", "printWidth": 100 }`. `.prettierignore`: `dist`, `pnpm-lock.yaml`, `LICENSES`, `apps/api/models`.
`commitlint.config.ts`: `extends: ['@commitlint/config-conventional']`, `scope-case: [2, 'always', 'kebab-case']`.
`lefthook.yml`: `pre-commit` runs `prettier --write {staged_files}` and `eslint --fix {staged_files}` on `*.{ts,tsx}` with `stage_fixed: true`; `commit-msg` runs `commitlint --edit {1}` and `node scripts/check-signoff.mjs {1}`.
`scripts/check-signoff.mjs`: exits 1 with `Commit must be signed off (use git commit -s)` unless the message contains a line matching `/^Signed-off-by: .+ <.+>$/m`.

- [ ] **Step 2: Install hooks**

Run: `pnpm add -Dw prettier lefthook @commitlint/cli @commitlint/config-conventional && pnpm lefthook install`
Expected: `sync hooks: ✔️ (pre-commit, commit-msg)`.

- [ ] **Step 3: Verify rejection and acceptance**

Run: `git commit --allow-empty -m "bad message"` → Expected: rejected by commitlint.
Run: `git commit --allow-empty -m "chore: hook check"` → Expected: rejected with `Commit must be signed off`.
Run: `git commit --allow-empty -s -m "chore: hook check"` → Expected: commit created. Then `git reset --soft HEAD~1`.

- [ ] **Step 4: Format repo and commit**

```bash
pnpm format
git add -A
git commit -s -m "chore: add prettier, lefthook, commitlint and DCO sign-off check"
```

---

### Task 0.5: Configuration module, `.env.example`, secrets generator

**Files:**

- Create: `apps/api/src/common/config/{config.schema.ts,load-config.ts,config.module.ts,index.ts}`
- Create: `apps/api/src/cli/secrets-generate.ts`, `.env.example`
- Test: `apps/api/src/common/config/load-config.spec.ts`, `apps/api/src/cli/secrets-generate.spec.ts`
- Modify: `docs/spec.md` §21 (add `CRAWL_USER_AGENT` row)

**Interfaces:**

- Produces:
  - `loadConfig(env: Record<string, string | undefined>): AppConfig` — throws `ConfigError` (`message` lists every problem, one per line, `- VAR: problem`).
  - `AppConfig` (exported type):
    ```ts
    type AppConfig = {
      nodeEnv: 'development' | 'test' | 'production';
      version: string;
      publicUrl: URL;
      database: {
        url: string;
        listenUrl: string;
        ssl: false | true | 'require';
        sslCa: string | null;
      };
      auth: { secrets: Buffer[]; accessTokenTtlMin: number; refreshTokenTtlDays: number };
      widgetSecret: Buffer;
      challengeSecret: Buffer | null;
      encryptionKeys: { version: number; key: Buffer }[]; // [0] encrypts
      signupMode: 'open' | 'invite' | 'closed';
      email:
        | { transport: 'none' }
        | {
            transport: 'smtp';
            host: string;
            port: number;
            user: string | null;
            pass: string | null;
            secure: boolean;
            from: string;
          }
        | { transport: 'resend'; apiKey: string; from: string };
      storageDir: string;
      maxUploadMb: number;
      crawl: { maxPages: number; respectRobots: boolean; userAgent: string };
      providerUrls: { allowPrivate: boolean; allowlist: string[]; denylist: string[] };
      localEmbeddings: boolean;
      logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
      retention: { conversationsDays: number; tracesDays: number };
    };
    ```
  - Nest provider token `APP_CONFIG` (`ConfigModule.forRoot(config: AppConfig)`).
  - `generateSecrets(): Record<'AUTH_SECRET' | 'WIDGET_SECRET' | 'CHALLENGE_SECRET' | 'ENCRYPTION_KEYS', string>`.

- [ ] **Step 1: Write failing tests**

```ts
const valid = {
  PUBLIC_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgres://u:p@localhost/db',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'0'.repeat(64)}`,
};

it('reports every invalid variable at once', () => {
  expect(() => loadConfig({ SIGNUP_MODE: 'Invite' })).toThrowError(
    expect.objectContaining({
      message: expect.stringMatching(
        /PUBLIC_URL[\s\S]*DATABASE_URL[\s\S]*AUTH_SECRET[\s\S]*WIDGET_SECRET[\s\S]*ENCRYPTION_KEYS[\s\S]*SIGNUP_MODE: expected one of open, invite, closed/,
      ),
    }),
  );
});
it('rejects short auth secrets', () =>
  expect(() => loadConfig({ ...valid, AUTH_SECRET: 'short' })).toThrow(
    /AUTH_SECRET: each secret must be at least 32 bytes/,
  ));
it('parses key rings, first entry encrypts', () => {
  const c = loadConfig({ ...valid, ENCRYPTION_KEYS: `v2:${'1'.repeat(64)},v1:${'0'.repeat(64)}` });
  expect(c.encryptionKeys.map((k) => k.version)).toEqual([2, 1]);
  expect(c.encryptionKeys[0]?.key.length).toBe(32);
});
it('rejects non-hex keys', () =>
  expect(() => loadConfig({ ...valid, ENCRYPTION_KEYS: 'v1:zz' })).toThrow(/ENCRYPTION_KEYS/));
it.each([
  ['open', undefined, false],
  ['invite', undefined, true],
  ['closed', 'auto', true],
  ['open', 'true', true],
  ['invite', 'false', false],
])('signup %s + ALLOW_PRIVATE_PROVIDER_URLS=%s → allowPrivate %s', (mode, allow, expected) =>
  expect(
    loadConfig({ ...valid, SIGNUP_MODE: mode, ALLOW_PRIVATE_PROVIDER_URLS: allow }).providerUrls
      .allowPrivate,
  ).toBe(expected),
);
it('applies defaults', () => {
  const c = loadConfig(valid);
  expect(c).toMatchObject({
    signupMode: 'invite',
    maxUploadMb: 20,
    localEmbeddings: true,
    auth: { accessTokenTtlMin: 15, refreshTokenTtlDays: 30 },
    crawl: { maxPages: 500, respectRobots: true },
    retention: { conversationsDays: 0, tracesDays: 90 },
    email: { transport: 'none' },
    storageDir: '/data/files',
  });
  expect(c.database.listenUrl).toBe(valid.DATABASE_URL);
});
it('requires SMTP_HOST and EMAIL_FROM for smtp', () =>
  expect(() => loadConfig({ ...valid, EMAIL_TRANSPORT: 'smtp' })).toThrow(
    /SMTP_HOST[\s\S]*EMAIL_FROM/,
  ));
it('accepts a comma-separated AUTH_SECRET list', () =>
  expect(
    loadConfig({ ...valid, AUTH_SECRET: `${'a'.repeat(32)},${'b'.repeat(32)}` }).auth.secrets,
  ).toHaveLength(2));
it('documents every variable in .env.example', () => {
  const documented = parseEnvExampleKeys(readFileSync(resolve(repoRoot, '.env.example'), 'utf8'));
  expect(documented.sort()).toEqual([...CONFIG_ENV_KEYS].sort());
});
```

`secrets-generate.spec.ts`: output of `generateSecrets()` passes `loadConfig({ ...requiredNonSecrets, ...generateSecrets() })`; `ENCRYPTION_KEYS` matches `/^v1:[0-9a-f]{64}$/`; two calls differ.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @app/api test:unit -- src/common/config src/cli`
Expected: FAIL, module not found. (Create the Vitest `unit` project now if missing: `apps/api/vitest.config.ts` with projects `unit` = `src/**/*.spec.ts` excluding `*.int.spec.ts`, `int` = `src/**/*.int.spec.ts`, `e2e` = `test/e2e/**/*.e2e.spec.ts`; plugin `unplugin-swc`; package scripts `test:unit`, `test:int`, `test:e2e` = `vitest run --project <name>`.)

- [ ] **Step 3: Implement**

`config.schema.ts` exports `CONFIG_ENV_KEYS` (every variable in spec §21 plus `DATABASE_LISTEN_URL`, `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `PROVIDER_URL_ALLOWLIST`, `PROVIDER_URL_DENYLIST`, `LOCAL_EMBEDDINGS`, `CHALLENGE_SECRET`, `CRAWL_USER_AGENT`, `NODE_ENV`) and one Zod object over raw strings. `loadConfig` runs `safeParse`, collects **all** issues, formats `- VAR: message`, and throws `ConfigError`. `CRAWL_USER_AGENT` default: `<project>-bot/<version> (+<PUBLIC_URL>)`. `version` comes from the api `package.json`.
`.env.example`: every key with a comment line copied from spec §21's description, required ones uncommented and empty.
`secrets-generate.ts`: `randomBytes(32).toString('base64url')` for the three secrets, `v1:` + 32 random bytes hex for keys; CLI prints `KEY=value` lines. Script: `"secrets:generate": "node -r @swc-node/register src/cli/secrets-generate.ts"` and root alias.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @app/api test:unit -- src/common/config src/cli`
Expected: PASS.

- [ ] **Step 5: Update spec §21**

Add row: `CRAWL_USER_AGENT` | | `<project>-bot/<version> (+PUBLIC_URL)` | User-Agent for crawling and URL sources.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -s -m "feat(api): validated environment config, .env.example and secrets generator"
```

---

### Task 0.6: Database infrastructure and test harness

**Files:**

- Create: `deploy/docker-compose.dev.yml`
- Create: `apps/api/src/db/{data-source.ts,cli-data-source.ts,naming-strategy.ts}`, `apps/api/src/db/migrations/0000000000000-extensions.ts`
- Create: `apps/api/test/{global-setup.int.ts,setup.ts}`, `apps/api/test/helpers/db.ts`
- Test: `apps/api/src/db/naming-strategy.spec.ts`, `apps/api/src/db/database.int.spec.ts`

**Interfaces:**

- Consumes: `loadConfig`, `AppConfig['database']` (0.5).
- Produces:
  - `buildDataSourceOptions(db: AppConfig['database']): DataSourceOptions`
  - `SnakeNamingStrategy`
  - `getTestDataSource(): Promise<DataSource>` (one per Vitest worker, URL from global setup via `inject('databaseUrl')`), `resetDatabase(ds: DataSource): Promise<void>` (truncates every table in `public` except `migrations`, and `pgboss.job`).
  - Scripts: `db:migrate`, `db:revert`, `db:generate <Name>`, `db:check`, root aliases.

- [ ] **Step 1: Dev compose**

`deploy/docker-compose.dev.yml`: `postgres` (`pgvector/pgvector:pg18`, port `5432`, `POSTGRES_USER/PASSWORD/DB = app`, volume `pgdev`, healthcheck `pg_isready -U app`), `mailpit` (`axllent/mailpit`, ports `1025`, `8025`).
Run: `docker compose -f deploy/docker-compose.dev.yml up -d` → Expected: both healthy.

- [ ] **Step 2: Write failing naming-strategy test**

```ts
const s = new SnakeNamingStrategy();
expect(s.columnName('workspaceId', undefined, [])).toBe('workspace_id');
expect(s.columnName('x', 'customName', [])).toBe('customName');
expect(s.joinColumnName('bot', 'id')).toBe('bot_id');
expect(s.joinTableName('bots', 'tags')).toBe('bots_tags');
```

- [ ] **Step 3: Write failing DB integration test**

```ts
it('has pgvector >= 0.8', async () => {
  const [{ extversion }] = await ds.query(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  expect(semver.gte(semver.coerce(extversion)!, '0.8.0')).toBe(true);
});
it('generates uuidv7 natively', async () => {
  const [{ id }] = await ds.query('SELECT uuidv7() AS id');
  expect(id[14]).toBe('7');
});
it('has citext', async () =>
  expect(await ds.query(`SELECT 1 FROM pg_extension WHERE extname='citext'`)).toHaveLength(1));
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @app/api test:unit -- src/db && pnpm --filter @app/api test:int -- src/db`
Expected: FAIL.

- [ ] **Step 5: Implement**

`buildDataSourceOptions`: `type: 'postgres'`, `url`, `ssl` (`require` → `{ rejectUnauthorized: !!sslCa, ca }`), `entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')]`, `migrations: [join(__dirname, 'migrations', '*.{ts,js}')]`, `namingStrategy`, `synchronize: false`, `migrationsTableName: 'migrations'`.
Migration `0000000000000-extensions`: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext;`.
`global-setup.int.ts`: starts `new PostgreSqlContainer('pgvector/pgvector:pg18')`, runs migrations once, `provide('databaseUrl', url)`, stops on teardown.
`test/setup.ts`: installs an undici `MockAgent` as global dispatcher with `disableNetConnect()` and `enableNetConnect(/^(localhost|127\.0\.0\.1)(:\d+)?$/)`.
Scripts: `db:<x>` = `node -r @swc-node/register ../../node_modules/typeorm/cli.js -d src/db/cli-data-source.ts migration:<run|revert|generate src/db/migrations/$npm_config_name>`; `db:check` = `… migration:generate --dryrun --check src/db/migrations/Check`.

- [ ] **Step 6: Run tests and migration commands**

Run: `pnpm --filter @app/api test:unit -- src/db && pnpm --filter @app/api test:int -- src/db`
Expected: PASS.
Run: `cp .env.example .env` (fill dev values + `pnpm secrets:generate`), `pnpm db:migrate && pnpm db:check`
Expected: migration `extensions` executed; `db:check` prints `No changes in database schema were found`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -s -m "feat(api): typeorm data source, migration commands and testcontainers harness"
```

---

### Task 0.7: API bootstrap — errors, request id, logging, request context, liveness

**Files:**

- Create: `packages/shared/src/{errors.ts,index.ts}`
- Create: `apps/api/src/common/errors/{app-error.ts,app-exception.filter.ts,index.ts}`
- Create: `apps/api/src/common/logging/{logger.options.ts,index.ts}`, `apps/api/src/common/context/request-context.ts`
- Create: `apps/api/src/app/http-app.module.ts`, `apps/api/src/app/create-http-app.ts`, `apps/api/src/main.ts`
- Create: `apps/api/src/modules/health/{health.module.ts,health.controller.ts,index.ts}`
- Create: `apps/api/test/helpers/app.ts`
- Test: `apps/api/test/e2e/bootstrap.e2e.spec.ts`, `apps/api/src/common/logging/logger.options.spec.ts`

**Interfaces:**

- Produces:
  - `packages/shared`: `ErrorCode` string-literal union (initial: `validation_failed`, `not_found`, `unauthorized`, `forbidden`, `conflict`, `rate_limited`, `payload_too_large`, `internal_error`; later tasks append), `errorEnvelopeSchema` (Zod), `type ErrorEnvelope`.
  - `class AppError extends Error { constructor(code: ErrorCode, opts?: { status?: number; message?: string; details?: { path: string; message: string }[]; cause?: unknown }) }` with default statuses (`validation_failed` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `payload_too_large` 413, `rate_limited` 429, else 500).
  - `createHttpApp(config: AppConfig, overrides?: { providers?: Provider[] }): Promise<NestFastifyApplication>` — global prefix `api`, filter, request-id hook, logger, CLS.
  - `RequestContext` (CLS store): `{ requestId: string; workspaceId?: string; userId?: string; botId?: string; conversationId?: string; jobId?: string }`.
  - `createTestApp(opts?: { config?: Partial<AppConfig>; providers?: Provider[] }): Promise<TestApp>` where `TestApp = { app; http: supertest.Agent; ds: DataSource; config: AppConfig; close(): Promise<void> }`.
  - `GET /api/health/live` → `200 { "status": "ok" }`.

- [ ] **Step 1: Write failing e2e tests**

```ts
it('returns the error envelope for unknown routes', async () => {
  const res = await t.http.get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({
    error: {
      code: 'not_found',
      message: expect.any(String),
      requestId: res.headers['x-request-id'],
    },
  });
});
it('generates a request id', async () =>
  expect((await t.http.get('/api/health/live')).headers['x-request-id']).toMatch(
    /^req_[0-9A-Za-z]{20,}$/,
  ));
it('echoes a valid incoming request id', async () =>
  expect(
    (await t.http.get('/api/health/live').set('X-Request-Id', 'req_abcdefghijklmnopqrstu')).headers[
      'x-request-id'
    ],
  ).toBe('req_abcdefghijklmnopqrstu'));
it('replaces an invalid incoming request id', async () =>
  expect(
    (await t.http.get('/api/health/live').set('X-Request-Id', 'x'.repeat(300))).headers[
      'x-request-id'
    ],
  ).not.toBe('x'.repeat(300)));
it('maps zod errors to validation_failed with details', async () => {
  const res = await t.http.post('/api/__test/echo').send({ name: 1 }); // test-only controller registered via overrides
  expect(res.status).toBe(400);
  expect(res.body.error).toMatchObject({
    code: 'validation_failed',
    details: [{ path: 'name', message: expect.any(String) }],
  });
});
it('hides internals of unknown errors', async () => {
  const res = await t.http.get('/api/__test/boom');
  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('internal_error');
  expect(JSON.stringify(res.body)).not.toContain('secret-detail');
});
```

`logger.options.spec.ts`: logging `{ headers: { authorization: 'Bearer x', cookie: 'a=b' }, password: 'p', apiKey: 'k', token: 't', secret: 's' }` through a Pino instance built from `buildLoggerOptions` writes `[Redacted]` for all six and never the raw values.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @app/api test:e2e -- test/e2e/bootstrap.e2e.spec.ts && pnpm --filter @app/api test:unit -- src/common/logging`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Fastify adapter; `onRequest` hook assigns `X-Request-Id` (`req_` + 24 base62 chars, accept incoming only if it matches `/^[A-Za-z0-9_-]{8,64}$/`), stores it in CLS, sets the response header.
- `AppExceptionFilter` maps `AppError`, `ZodValidationException` (nestjs-zod), Nest `NotFoundException` (→ `not_found`), Fastify body-limit errors (→ `payload_too_large`), everything else → `internal_error` (logged at `error` with stack).
- `buildLoggerOptions(config)`: `nestjs-pino` with `level: config.logLevel`, redact paths `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.secret`, `*.apiKey`, `*.token`, `*.authorization`, `*.cookie`; `customProps` reads CLS fields.
- `main.ts`: `loadConfig(process.env)` → `createHttpApp` → `listen(3000, '0.0.0.0')`; on `ConfigError` print message and `process.exit(1)`.

- [ ] **Step 4: Run to verify pass**

Same commands. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -s -m "feat(api): nest bootstrap with error envelope, request ids, redacted logging and liveness"
```

---

### Task 0.8: Branded ids and `TenantRepository`

**Files:**

- Create: `apps/api/src/db/{ids.ts,tenant-entity.ts,tenant-repository.ts,pagination.ts}`
- Create: `packages/shared/src/pagination.ts`
- Test: `apps/api/src/db/tenant-repository.int.spec.ts`, `apps/api/src/db/pagination.spec.ts`

**Interfaces:**

- Produces:
  - Branded types `WorkspaceId`, `UserId`, `BotId`, `ContactId`, `ConversationId`, `CredentialId`, `SourceId`, `MessageId` and parsers `asWorkspaceId(v: string): WorkspaceId` … (throw `AppError('not_found')` on non-UUID, so malformed ids look like missing ones).
  - `abstract class TenantEntity { id: string; workspaceId: WorkspaceId }`
  - `abstract class TenantRepository<T extends TenantEntity>` with `protected constructor(repo: Repository<T>)` and:
    - `findById(ws: WorkspaceId, id: string): Promise<T | null>`
    - `getById(ws: WorkspaceId, id: string, notFound?: ErrorCode): Promise<T>` (default code `not_found`)
    - `list(ws: WorkspaceId, opts: { limit: number; cursor: string | null; where?: FindOptionsWhere<T> }): Promise<Page<T>>` ordered `id DESC` (UUIDv7 = newest first)
    - `insert(ws: WorkspaceId, data: DeepPartial<T>): Promise<T>`
    - `updateById(ws: WorkspaceId, id: string, patch: QueryDeepPartialEntity<T>): Promise<T>` (throws `not_found` when 0 rows)
    - `deleteById(ws: WorkspaceId, id: string): Promise<void>` (throws `not_found` when 0 rows)
  - `packages/shared`: `pageQuerySchema` (`limit` 1–100 default 50, `cursor` optional string), `type Page<T> = { data: T[]; nextCursor: string | null }`.
  - `encodeCursor(id: string): string`, `decodeCursor(c: string): string` (base64url; invalid → `AppError('validation_failed')`).

- [ ] **Step 1: Write failing tests**

Test entity `TestThingEntity` (`__test_things`: `id uuid default uuidv7()`, `workspace_id uuid`, `name text`) created by the test with raw SQL and a dedicated `DataSource`.

```ts
it('never returns rows from another workspace', async () => {
  const a = await repo.insert(wsA, { name: 'a' });
  expect(await repo.findById(wsB, a.id)).toBeNull();
  await expect(repo.getById(wsB, a.id)).rejects.toMatchObject({ code: 'not_found' });
});
it('refuses cross-workspace update and delete', async () => {
  const a = await repo.insert(wsA, { name: 'a' });
  await expect(repo.updateById(wsB, a.id, { name: 'x' })).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(repo.deleteById(wsB, a.id)).rejects.toMatchObject({ code: 'not_found' });
  expect((await repo.getById(wsA, a.id)).name).toBe('a');
});
it('paginates newest first with cursors', async () => {
  for (const n of ['1', '2', '3']) await repo.insert(wsA, { name: n });
  const p1 = await repo.list(wsA, { limit: 2, cursor: null });
  expect(p1.data.map((r) => r.name)).toEqual(['3', '2']);
  const p2 = await repo.list(wsA, { limit: 2, cursor: p1.nextCursor });
  expect(p2).toMatchObject({ data: [{ name: '1' }], nextCursor: null });
});
it('treats malformed ids as not found', () =>
  expect(() => asWorkspaceId('nope')).toThrow(expect.objectContaining({ code: 'not_found' })));
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:int -- src/db/tenant-repository` → FAIL.
- [ ] **Step 3: Implement** the signatures above. `insert` forces `workspaceId = ws` even if `data` contains another value.
- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): branded ids and workspace-scoped base repository"`

---

### Task 0.9: Schema part A — identity, tenancy, instance, audit, files

**Files:**

- Create entities: `apps/api/src/modules/auth/entities/{user,auth-session,email-token}.entity.ts`, `apps/api/src/modules/workspaces/entities/{workspace,membership,invitation}.entity.ts`, `apps/api/src/modules/audit/audit-log.entity.ts`, `apps/api/src/common/storage/file.entity.ts`, `apps/api/src/modules/instance/entities/{instance-setting,worker-heartbeat}.entity.ts`
- Create: `packages/shared/src/enums.ts`
- Create: generated migration `apps/api/src/db/migrations/<ts>-schema-identity.ts` + hand-written `<ts>-identity-constraints.ts`
- Test: `apps/api/src/db/schema-identity.int.spec.ts`

**Interfaces:**

- Produces: entity classes `UserEntity`, `AuthSessionEntity`, `EmailTokenEntity`, `WorkspaceEntity`, `MembershipEntity`, `InvitationEntity`, `AuditLogEntity`, `FileEntity`, `InstanceSettingEntity`, `WorkerHeartbeatEntity`; shared enums `ROLES = ['owner','admin','agent'] as const`, `EMAIL_TOKEN_TYPES = ['verify_email','reset_password'] as const` (+ `type Role`, …).

- [ ] **Step 1: Write failing schema test**

```ts
const cols = async (t: string) =>
  await ds.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name=$1`,
    [t],
  );
it('creates users with citext email and token_version', async () => {
  const c = await cols('users');
  expect(c).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ column_name: 'email', data_type: 'USER-DEFINED' }),
      expect.objectContaining({
        column_name: 'token_version',
        data_type: 'integer',
        column_default: '0',
      }),
      expect.objectContaining({ column_name: 'id', column_default: 'uuidv7()' }),
    ]),
  );
});
it('allows exactly one owner per workspace', async () => {
  // insert workspace + two users, first owner ok, second owner → unique violation 23505
});
it('enforces case-insensitive unique emails', async () => {
  /* 'A@x.com' then 'a@x.com' → 23505 */
});
it('has every table from spec §9.1, §9.6 and instance tables', async () => {
  const names = (await ds.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).map(
    (r: any) => r.tablename,
  );
  expect(names).toEqual(
    expect.arrayContaining([
      'users',
      'auth_sessions',
      'email_tokens',
      'workspaces',
      'memberships',
      'invitations',
      'audit_log',
      'files',
      'instance_settings',
      'worker_heartbeats',
    ]),
  );
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:int -- src/db/schema-identity` → FAIL.

- [ ] **Step 3: Write entities**

Columns exactly as spec §9.1 and §9.6 (v1.1), including `users.token_version int not null default 0`, `workspaces.deleted_at`, `auth_sessions` refresh columns, `instance_settings`, `worker_heartbeats`. Ids: `@PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })`. Postgres enums via `enum` + `enumName` matching shared enum names (`role`, `email_token_type`). `audit_log.ip` type `inet`. Every tenant table indexes `workspace_id`.

- [ ] **Step 4: Generate migration, add constraints by hand**

Run: `pnpm db:generate --name=schema-identity` and review the SQL (no drops, correct types).
Hand-written `identity-constraints`: `CREATE UNIQUE INDEX memberships_one_owner ON memberships (workspace_id) WHERE role = 'owner';`, `CREATE INDEX auth_sessions_user_active ON auth_sessions (user_id) WHERE revoked_at IS NULL;`. Declare both on entities with `@Index(name, { synchronize: false })`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @app/api test:int -- src/db/schema-identity && pnpm db:migrate && pnpm db:check`
Expected: PASS; `No changes in database schema were found`.

- [ ] **Step 6: Commit** — `git commit -s -m "feat(db): identity, tenancy, audit, files and instance tables"`

---

### Task 0.10: Crypto, clock and id helpers

**Files:**

- Create: `apps/api/src/common/crypto/{secret-box.ts,hash.ts,index.ts}`, `apps/api/src/common/clock.ts`, `apps/api/src/common/ids.ts`
- Test: `apps/api/src/common/crypto/secret-box.spec.ts`, `hash.spec.ts`, `apps/api/src/common/ids.spec.ts`

**Interfaces:**

- Produces:
  - `type Sealed = { ciphertext: Buffer; iv: Buffer; tag: Buffer; keyVersion: number }`
  - `class SecretBox { constructor(keys: { version: number; key: Buffer }[]); seal(plain: string): Sealed; open(s: Sealed): string; needsReencrypt(s: Sealed): boolean }`
  - `sha256Hex(input: string | Buffer): string`, `randomToken(bytes?: number): string` (base64url, default 32), `timingSafeEqualStr(a: string, b: string): boolean`
  - `abstract class Clock { abstract now(): Date }`, `class SystemClock`, `class FixedClock { constructor(at: Date); set(at: Date): void; advance(ms: number): void }`
  - `newId(): string` (UUIDv7, `uuid` package), `newPublicKey(): string` (`pk_live_` + 24 base62), `newRequestId(): string`

- [ ] **Step 1: Write failing tests**

```ts
const k1 = { version: 1, key: randomBytes(32) },
  k2 = { version: 2, key: randomBytes(32) };
it('round-trips', () => {
  const b = new SecretBox([k1]);
  expect(b.open(b.seal('sk-123'))).toBe('sk-123');
});
it('uses a fresh 12-byte iv each time', () => {
  const b = new SecretBox([k1]);
  const a = b.seal('x'),
    c = b.seal('x');
  expect(a.iv).toHaveLength(12);
  expect(a.iv.equals(c.iv)).toBe(false);
});
it('decrypts with older keys and encrypts with the first', () => {
  const old = new SecretBox([k1]).seal('s');
  const ring = new SecretBox([k2, k1]);
  expect(ring.open(old)).toBe('s');
  expect(ring.seal('s').keyVersion).toBe(2);
  expect(ring.needsReencrypt(old)).toBe(true);
});
it('detects tampering', () => {
  const b = new SecretBox([k1]);
  const s = b.seal('x');
  s.ciphertext[0] ^= 1;
  expect(() => b.open(s)).toThrow();
});
it('fails clearly for an unknown key version', () =>
  expect(() => new SecretBox([k2]).open(new SecretBox([k1]).seal('x'))).toThrow(/key version 1/));
it('randomToken has 256 bits', () =>
  expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32));
it('newId is v7 and sortable', () => {
  const a = newId(),
    b = newId();
  expect(a[14]).toBe('7');
  expect(a < b).toBe(true);
});
it('public keys look right', () => expect(newPublicKey()).toMatch(/^pk_live_[0-9A-Za-z]{24}$/));
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:unit -- src/common/crypto src/common/ids` → FAIL.
- [ ] **Step 3: Implement** with `node:crypto` AES-256-GCM, 12-byte IV, 16-byte tag; error message for missing key: `Encryption key version ${v} is not configured`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): AES-GCM secret box with key rotation, hashing, clock and id helpers"`

---

### Task 0.11: IP and URL classification

**Files:**

- Create: `apps/api/src/common/safe-fetch/{classify-ip.ts,parse-target.ts}`
- Test: `apps/api/src/common/safe-fetch/classify-ip.spec.ts`, `parse-target.spec.ts`

**Interfaces:**

- Produces:
  - `type IpClass = 'public' | 'private' | 'loopback' | 'link_local' | 'cgnat' | 'multicast' | 'reserved' | 'metadata' | 'unspecified'`
  - `classifyIp(ip: string): IpClass` (handles IPv4, IPv6, IPv4-mapped IPv6 by classifying the embedded v4)
  - `parseTarget(raw: string): { url: URL; host: string; port: number; hostIsIp: boolean }` — normalizes decimal/hex/octal IPv4 hosts via WHATWG URL parsing; throws `SafeFetchError('blocked_scheme')` for non-http(s).

- [ ] **Step 1: Write failing tests**

```ts
it.each([
  ['8.8.8.8', 'public'],
  ['10.1.2.3', 'private'],
  ['172.16.0.1', 'private'],
  ['172.31.255.255', 'private'],
  ['192.168.1.1', 'private'],
  ['127.0.0.1', 'loopback'],
  ['127.9.9.9', 'loopback'],
  ['0.0.0.0', 'unspecified'],
  ['169.254.169.254', 'metadata'],
  ['169.254.1.1', 'link_local'],
  ['100.64.0.1', 'cgnat'],
  ['224.0.0.1', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.255', 'reserved'],
  ['::1', 'loopback'],
  ['::', 'unspecified'],
  ['fe80::1', 'link_local'],
  ['fc00::1', 'private'],
  ['fd00::1', 'private'],
  ['fd00:ec2::254', 'metadata'],
  ['ff02::1', 'multicast'],
  ['::ffff:127.0.0.1', 'loopback'],
  ['::ffff:10.0.0.1', 'private'],
  ['2001:4860:4860::8888', 'public'],
  ['64:ff9b::7f00:1', 'loopback'],
])('%s → %s', (ip, cls) => expect(classifyIp(ip)).toBe(cls));

it.each(['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/'])(
  '%s normalizes to 127.0.0.1',
  (raw) => expect(parseTarget(raw).host).toBe('127.0.0.1'),
);
it.each(['file:///etc/passwd', 'gopher://x', 'ftp://x'])('%s is blocked', (raw) =>
  expect(() => parseTarget(raw)).toThrow(expect.objectContaining({ code: 'blocked_scheme' })),
);
it('defaults ports', () => {
  expect(parseTarget('https://a.com').port).toBe(443);
  expect(parseTarget('http://a.com').port).toBe(80);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:unit -- src/common/safe-fetch` → FAIL.
- [ ] **Step 3: Implement** with `ipaddr.js` (`parse`, `range()`, `isIPv4MappedAddress`, NAT64 `64:ff9b::/96` → embedded v4). Metadata list: `169.254.169.254`, `fd00:ec2::254`, `100.100.100.200`. `SafeFetchError` (`code: 'blocked_scheme' | 'blocked_port' | 'blocked_address' | 'blocked_host' | 'dns_failed' | 'too_many_redirects' | 'too_large' | 'timeout' | 'bad_content_type' | 'connection_failed'`) defined in `safe-fetch-error.ts`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): ip classification and url target parsing for ssrf protection"`

---

### Task 0.12: `safeFetch`

**Files:**

- Create: `apps/api/src/common/safe-fetch/{safe-fetch.ts,policies.ts,index.ts}`
- Test: `apps/api/src/common/safe-fetch/safe-fetch.int.spec.ts`

**Interfaces:**

- Consumes: `classifyIp`, `parseTarget`, `SafeFetchError` (0.11), `AppConfig` (0.5).
- Produces:
  - `type FetchPolicy = { name: 'crawl' | 'provider' | 'webhook'; allowPrivate: boolean; allowHosts: string[]; denyHosts: string[]; allowedPorts: number[] | 'any'; maxBytes: number; connectTimeoutMs: number; totalTimeoutMs: number; maxRedirects: number; contentTypes: string[] | null; userAgent: string }`
  - `safeFetch(input: string | URL, init: RequestInit & { signal?: AbortSignal }, policy: FetchPolicy, deps?: { lookup?: LookupFn }): Promise<Response>` — returned body is a size-limited stream.
  - `crawlPolicy(config: AppConfig): FetchPolicy` (`allowPrivate: false`, ports `[80, 443]`, `maxBytes: 5 MiB`, connect 10 s, total 30 s, 5 redirects, content types `text/html`, `application/xhtml+xml`, `application/xml`, `text/xml`, `text/plain`, `application/pdf`).
  - `providerPolicy(config: AppConfig): FetchPolicy` (`allowPrivate` from config, `allowedPorts: 'any'`, `maxBytes: 50 MiB`, total 120 s, 0 redirects, deny hosts always include `postgres`, `api`, `worker`, `web`, `caddy`, `migrate`, `metadata.google.internal`, plus config denylist; metadata IPs are blocked even when `allowPrivate`).
  - `type LookupFn = (host: string) => Promise<{ address: string; family: 4 | 6 }[]>`

- [ ] **Step 1: Write failing tests**

A local `http.createServer` on `127.0.0.1` serves `/ok`, `/big` (6 MiB), `/slow` (never ends), `/redirect-private` (302 → `http://10.0.0.1/`), `/redirect-ok` (302 → `/ok`), `/pdf` (content-type `application/pdf`), `/exe` (content-type `application/octet-stream`). Tests use a `lookup` stub that maps `public.test` → `127.0.0.1` and a policy built with `allowHosts: ['public.test']` to reach the local server, while every other private address stays blocked.

```ts
it('blocks private targets for crawl', () =>
  expect(safeFetch('http://10.0.0.5/', {}, crawl)).rejects.toMatchObject({
    code: 'blocked_address',
  }));
it('blocks loopback via decimal ip', () =>
  expect(safeFetch('http://2130706433/', {}, crawl)).rejects.toMatchObject({
    code: 'blocked_address',
  }));
it('blocks metadata even when private is allowed', () =>
  expect(
    safeFetch('http://169.254.169.254/latest', {}, { ...provider, allowPrivate: true }),
  ).rejects.toMatchObject({ code: 'blocked_address' }));
it('blocks compose service names for providers', () =>
  expect(
    safeFetch('http://postgres:5432/', {}, { ...provider, allowPrivate: true }),
  ).rejects.toMatchObject({ code: 'blocked_host' }));
it('blocks non-allowed ports for crawl', () =>
  expect(safeFetch('http://public.test:8081/ok', {}, crawl)).rejects.toMatchObject({
    code: 'blocked_port',
  }));
it('connects to the pinned address', async () => {
  const lookup = vi
    .fn()
    .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    .mockResolvedValue([{ address: '10.9.9.9', family: 4 }]);
  const res = await safeFetch(`http://public.test:${port}/ok`, {}, testPolicy, { lookup });
  expect(await res.text()).toBe('ok');
  expect(lookup).toHaveBeenCalledTimes(1);
});
it('re-validates every redirect hop', () =>
  expect(
    safeFetch(`http://public.test:${port}/redirect-private`, {}, testPolicy, { lookup }),
  ).rejects.toMatchObject({ code: 'blocked_address' }));
it('follows safe redirects', async () =>
  expect(
    await (
      await safeFetch(`http://public.test:${port}/redirect-ok`, {}, testPolicy, { lookup })
    ).text(),
  ).toBe('ok'));
it('stops at maxRedirects', () =>
  expect(
    safeFetch(`http://public.test:${port}/loop`, {}, testPolicy, { lookup }),
  ).rejects.toMatchObject({ code: 'too_many_redirects' }));
it('enforces size while streaming', async () => {
  const res = await safeFetch(`http://public.test:${port}/big`, {}, testPolicy, { lookup });
  await expect(res.arrayBuffer()).rejects.toMatchObject({ code: 'too_large' });
});
it('times out', () =>
  expect(
    safeFetch(
      `http://public.test:${port}/slow`,
      {},
      { ...testPolicy, totalTimeoutMs: 200 },
      { lookup },
    ),
  ).rejects.toMatchObject({ code: 'timeout' }));
it('enforces content types', () =>
  expect(
    safeFetch(`http://public.test:${port}/exe`, {}, testPolicy, { lookup }),
  ).rejects.toMatchObject({ code: 'bad_content_type' }));
it('sends the policy user agent', async () => {
  /* server echoes UA; expect it to equal testPolicy.userAgent */
});
it('blocks hosts whose DNS returns any private address', () => {
  /* lookup → [public, private] → blocked_address */
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:int -- src/common/safe-fetch` → FAIL.

- [ ] **Step 3: Implement**

Per hop: `parseTarget` → scheme/port check → host deny/allow check → resolve once via `lookup` (default `dns.promises.lookup(host, { all: true })`) → reject if any resolved address is non-public (unless `allowPrivate`; metadata always rejected) → request through an undici `Agent` whose `connect` option pins the resolved IP (`connect: { lookup: (_h, _o, cb) => cb(null, pinned) }`), keeping `Host`/SNI = original host → `redirect: 'manual'`; on 3xx resolve `Location` against the current URL and loop up to `maxRedirects` → check `content-type` → wrap body in a `TransformStream` that errors with `too_large` past `maxBytes`. `AbortSignal.any([init.signal, AbortSignal.timeout(totalTimeoutMs)])`.

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): ssrf-safe fetch with dns pinning, redirect checks and size limits"`

---

### Task 0.13: LLM layer — error mapping, registry, mock models, `Llm` service

**Files:**

- Create: `packages/shared/src/providers.ts`
- Create: `apps/api/src/providers/{types.ts,errors.ts,registry.ts,llm.service.ts,snapshot.ts,providers.module.ts,index.ts}`, `apps/api/src/providers/mock/mock-models.ts`
- Test: `apps/api/src/providers/{errors.spec.ts,snapshot.spec.ts,llm.service.spec.ts}`

**Interfaces:**

- Consumes: `safeFetch`, `providerPolicy` (0.12), `Clock` (0.10).
- Produces:
  - shared: `PROVIDER_KINDS = ['openai','anthropic','gemini','groq','mistral','ollama','openai_compatible','local','mock'] as const`, `PROVIDER_ERROR_CODES = ['auth_failed','rate_limited','quota_exceeded','model_not_found','timeout','aborted','connection_failed','blocked_url','local_model_unavailable','provider_error'] as const`.
  - `type ResolvedCredential = { id: CredentialId; workspaceId: WorkspaceId; provider: ProviderKind; apiKey: string | null; baseUrl: string | null; updatedAt: Date }`
  - `interface CredentialResolver { resolveForUse(ws: WorkspaceId, id: CredentialId): Promise<ResolvedCredential> }` + token `CREDENTIAL_RESOLVER`
  - `class ProviderError extends Error { code: ProviderErrorCode; status: number | null; safeMessage: string }`; `toProviderError(e: unknown): ProviderError`
  - `class ProviderRegistry { languageModel(c: ResolvedCredential, modelId: string): LanguageModel; embeddingModel(c: ResolvedCredential, modelId: string): EmbeddingModel<string>; register(kind: ProviderKind, factory: ProviderFactory): void }` (LRU 100 keyed `${id}:${updatedAt.getTime()}:${modelId}`); M0 registers `mock` and (0.14) `local`.
  - `class Llm` implementing the spec §11.3 `Llm` interface (`streamChat`, `embed`) — exact request/response types from spec §11.3.
  - `capSnapshot(value: unknown, maxBytes = 65536): unknown` → value as-is if its JSON ≤ maxBytes, else `{ truncated: true, bytes: n, preview: <first maxBytes chars> }`.
  - `createMockLanguageModel(opts?: { reply?: (lastUserText: string) => string; chunkSize?: number; delayMs?: number; failWith?: Error }): LanguageModel` (default reply: `` `Mock answer about "${lastUserText.slice(0, 40)}" [1].` ``; usage = ceil(chars/4)); `createMockEmbeddingModel(opts?: { dimensions?: number }): EmbeddingModel<string>` (default 384; deterministic unit vectors seeded from SHA-256 of the text).

- [ ] **Step 1: Write failing tests**

```ts
// errors.spec.ts
const apiErr = (statusCode: number, responseBody = '') =>
  new APICallError({
    message: 'x',
    url: 'https://p',
    requestBodyValues: {},
    statusCode,
    responseBody,
  });
it.each([
  [401, 'auth_failed'],
  [403, 'auth_failed'],
  [404, 'model_not_found'],
  [429, 'rate_limited'],
  [500, 'provider_error'],
])('status %i → %s', (s, code) => expect(toProviderError(apiErr(s)).code).toBe(code));
it('429 with quota body → quota_exceeded', () =>
  expect(toProviderError(apiErr(429, '{"error":{"code":"insufficient_quota"}}')).code).toBe(
    'quota_exceeded',
  ));
it('unwraps RetryError', () =>
  expect(
    toProviderError(
      new RetryError({ message: 'r', reason: 'maxRetriesExceeded', errors: [apiErr(401)] }),
    ).code,
  ).toBe('auth_failed'));
it('maps timeouts and aborts', () => {
  expect(toProviderError(new DOMException('t', 'TimeoutError')).code).toBe('timeout');
  expect(toProviderError(new DOMException('a', 'AbortError')).code).toBe('aborted');
});
it('maps SafeFetchError', () =>
  expect(toProviderError(new SafeFetchError('blocked_address')).code).toBe('blocked_url'));
it('never exposes the response body', () =>
  expect(toProviderError(apiErr(500, 'sk-secret-123')).safeMessage).not.toContain('sk-secret'));

// llm.service.spec.ts (resolver stub returns { provider: 'mock' })
it('streams text and resolves usage, ttft and snapshot', async () => {
  const r = llm.streamChat({
    workspaceId: ws,
    credentialId: cid,
    model: 'mock-chat',
    messages: [{ role: 'user', content: 'refund?' }],
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  });
  let text = '';
  for await (const d of r.textStream) text += d;
  const f = await r.final;
  expect(text).toBe('Mock answer about "refund?" [1].');
  expect(f.inputTokens).toBeGreaterThan(0);
  expect(f.outputTokens).toBe(Math.ceil(text.length / 4));
  expect(f.ttftMs).toBeGreaterThanOrEqual(0);
  expect(f.requestSnapshot).toBeDefined();
});
it('retries chat exactly once', async () => {
  /* failWith 500 → model called 2 times, final rejects ProviderError provider_error */
});
it('maps provider errors', async () => {
  /* failWith apiErr(401) → rejects { code: 'auth_failed' } */
});
it('embeds deterministically', async () => {
  const a = await llm.embed({
    workspaceId: ws,
    credentialId: cid,
    model: 'mock-embed',
    inputs: ['x', 'y'],
    signal,
  });
  const b = await llm.embed({
    workspaceId: ws,
    credentialId: cid,
    model: 'mock-embed',
    inputs: ['x'],
    signal,
  });
  expect(a.vectors[0]).toEqual(b.vectors[0]);
  expect(a.vectors[0]).toHaveLength(384);
  expect(a.tokens).toBeGreaterThan(0);
});
it('does not retry embeddings', async () => {
  /* failWith → called once */
});
// snapshot.spec.ts
it('keeps small values', () => expect(capSnapshot({ a: 1 })).toEqual({ a: 1 }));
it('truncates large values', () =>
  expect(capSnapshot({ a: 'x'.repeat(70_000) })).toMatchObject({ truncated: true }));
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:unit -- src/providers` → FAIL.

- [ ] **Step 3: Implement**

`Llm.streamChat` → `streamText({ model, messages, maxOutputTokens, temperature, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), maxRetries: 1 })`; `textStream` re-yields `result.textStream` and records the time of the first non-empty delta; `final` awaits `result.usage` and `result.request` (`body` → `capSnapshot`), mapping errors via `toProviderError`. `Llm.embed` → `embedMany({ model, values: inputs, maxRetries: 0, abortSignal })`. Mock models use the AI SDK test model classes of the installed major (`ai/test`) and `simulateReadableStream`. Nothing outside `src/providers/` imports `ai`.

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): llm service on the vercel ai sdk with error mapping and mock models"`

---

### Task 0.14: Built-in local embedding model

**Files:**

- Create: `apps/api/models/manifest.json`, `apps/api/src/cli/fetch-model.ts`
- Create: `apps/api/src/providers/local/{local-embedding-model.ts,index.ts}`
- Test: `apps/api/src/providers/local/local-embedding-model.int.spec.ts`, `apps/api/src/cli/fetch-model.spec.ts`

**Interfaces:**

- Produces:
  - `manifest.json`: `{ "id": "bge-small-en-v1.5", "repo": "Xenova/bge-small-en-v1.5", "revision": "<pinned commit sha>", "dimensions": 384, "license": "MIT", "files": [{ "path": "onnx/model_quantized.onnx", "sha256": "…" }, { "path": "tokenizer.json", … }, { "path": "tokenizer_config.json", … }, { "path": "config.json", … }, { "path": "special_tokens_map.json", … }] }`
  - `pnpm --filter @app/api fetch-model` downloads into `apps/api/models/bge-small-en-v1.5/` and verifies each SHA-256 (mismatch → delete file, exit 1).
  - `createLocalEmbeddingModel(opts: { modelDir: string; batchSize?: number }): EmbeddingModel<string>` (model id `bge-small-en-v1.5`, `maxEmbeddingsPerCall = batchSize ?? 16`, CLS pooling, normalized, `env.allowRemoteModels = false`, lazy singleton pipeline per process).
  - `localModelStatus(modelDir: string): 'ready' | 'missing'`.
  - Registry registers `local`; when files are missing, `embeddingModel()` throws `ProviderError('local_model_unavailable')`.

- [ ] **Step 1: Write failing tests**

```ts
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
it('returns 384-dim unit vectors', async () => {
  const { embeddings } = await embedMany({ model, values: ['hello'] });
  expect(embeddings[0]).toHaveLength(384);
  expect(Math.abs(Math.hypot(...embeddings[0]!) - 1)).toBeLessThan(1e-3);
});
it('is deterministic', async () => {
  /* same input twice → toEqual */
});
it('ranks related text higher', async () => {
  const [q, rel, unrel] = (
    await embedMany({
      model,
      values: [
        'How do I get a refund?',
        'Refund policy: you can return items within 30 days for a full refund.',
        'Our office is located in Berlin.',
      ],
    })
  ).embeddings;
  expect(cos(q!, rel!)).toBeGreaterThan(cos(q!, unrel!) + 0.1);
});
it('handles batches larger than the per-call limit', async () =>
  expect(
    (await embedMany({ model, values: Array.from({ length: 40 }, (_, i) => `t${i}`) })).embeddings,
  ).toHaveLength(40));
it('reports missing files', () => expect(localModelStatus('/nonexistent')).toBe('missing'));
it('throws local_model_unavailable when missing', () =>
  expect(() => registry.embeddingModel({ ...localCred }, 'bge-small-en-v1.5')).toThrow(
    expect.objectContaining({ code: 'local_model_unavailable' }),
  ));
// fetch-model.spec.ts: with a stubbed downloader returning wrong bytes → rejects /checksum mismatch for onnx\/model_quantized.onnx/
```

- [ ] **Step 2: Run** `pnpm --filter @app/api fetch-model` then `pnpm --filter @app/api test:int -- src/providers/local` → FAIL (not implemented).
- [ ] **Step 3: Implement** per Interfaces. Fill `manifest.json` checksums from the pinned revision (`sha256sum` after a first verified download).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): built-in local embedding model with checksummed fetch"`

---

### Task 0.15: Provider contract test suite

**Files:**

- Create: `apps/api/src/providers/__contract__/{chat-contract.ts,embedding-contract.ts}`
- Test: `apps/api/src/providers/mock/mock.contract.spec.ts`, `apps/api/src/providers/local/local.contract.int.spec.ts`

**Interfaces:**

- Produces: `runChatContract(name: string, make: () => { llm: Llm; credentialId: CredentialId; workspaceId: WorkspaceId; model: string }, opts?: { skipErrorCases?: boolean }): void`; `runEmbeddingContract(name, make: () => { llm; credentialId; workspaceId; model; dimensions: number }): void`. Reused by the live workflow in Task 2.9.

- [ ] **Step 1: Write the contract suites**

Chat cases: `concatenated deltas equal the final text`; `usage is reported once with inputTokens > 0 and outputTokens > 0`; `aborting after the first delta ends iteration within 1000 ms and final rejects with code aborted`; `ttftMs is less than total latency`. Embedding cases: `returns one vector per input`, `vectors have the declared dimensions`, `tokens > 0`, `empty input list returns []`.

- [ ] **Step 2: Run against mock and local**

Run: `pnpm --filter @app/api test:unit -- src/providers/mock && pnpm --filter @app/api test:int -- src/providers/local`
Expected: PASS (fix any adapter behavior the contract exposes).

- [ ] **Step 3: Commit** — `git commit -s -m "test(api): provider contract suite for chat and embeddings"`

---

### Task 0.16: Job queue, worker entrypoint, heartbeat, readiness

**Files:**

- Create: `apps/api/src/jobs/{define-job.ts,jobs.module.ts,jobs.service.ts,job-processor.decorator.ts,jobs.worker.ts,index.ts}`
- Create: `apps/api/src/app/worker-app.module.ts`, `apps/api/src/worker.ts`
- Create: `apps/api/src/modules/instance/heartbeat.service.ts`
- Modify: `apps/api/src/modules/health/health.controller.ts` (add `ready`)
- Test: `apps/api/src/jobs/jobs.int.spec.ts`, `apps/api/src/modules/instance/heartbeat.int.spec.ts`, `apps/api/test/e2e/health.e2e.spec.ts`

**Interfaces:**

- Produces:
  - `defineJob<P>(def: { name: string; schema: z.ZodType<P>; retryLimit: number; retryBackoff: boolean; retryDelaySec?: number; concurrency: number; expireInSec?: number }): JobDef<P>`
  - `JobsService.enqueue<P>(def: JobDef<P>, payload: P, opts?: { manager?: EntityManager; singletonKey?: string; startAfter?: Date | number }): Promise<string | null>` (validates payload, `AppError('internal_error')` on invalid payload, uses `manager` as pg-boss `db` adapter so the job commits with the caller's transaction)
  - `@JobProcessor(def)` class decorator; processor classes implement `handle(payload: P, ctx: { jobId: string; attempt: number; signal: AbortSignal }): Promise<void>`
  - `HeartbeatService.beat(): Promise<void>` (upsert `worker_heartbeats` with `clock.now()` and version), interval 30 s in the worker
  - `GET /api/health/ready` → `200 { status: 'ok', checks: { db: 'ok', migrations: 'ok', queue: 'ok', pgvector: '<version>' } }` or `503` with the failing check set to an error string (`pgvector >= 0.8 required`, `pending migrations`, …)

- [ ] **Step 1: Write failing tests**

```ts
const Echo = defineJob({
  name: 'test.echo',
  schema: z.object({ n: z.number() }),
  retryLimit: 2,
  retryBackoff: false,
  concurrency: 1,
});
it('drops jobs enqueued in a rolled-back transaction', async () => {
  await ds
    .transaction(async (m) => {
      await jobs.enqueue(Echo, { n: 1 }, { manager: m });
      throw new Error('rollback');
    })
    .catch(() => {});
  expect(await countJobs('test.echo')).toBe(0);
});
it('delivers committed jobs with validated payloads', async () => {
  /* processor records payloads; expect [{ n: 1 }] within 5 s */
});
it('rejects invalid payloads at enqueue time', () =>
  expect(jobs.enqueue(Echo, { n: 'x' } as never)).rejects.toThrow());
it('retries until retryLimit', async () => {
  /* handler throws twice then succeeds → 3 attempts */
});
it('writes a heartbeat', async () => {
  clock.set(new Date('2026-01-01T00:00:00Z'));
  await hb.beat();
  expect(
    (await ds.query('SELECT last_beat_at FROM worker_heartbeats'))[0].last_beat_at.toISOString(),
  ).toBe('2026-01-01T00:00:00.000Z');
});
// health.e2e.spec.ts
it('is ready on a migrated db', async () =>
  expect((await t.http.get('/api/health/ready')).body).toMatchObject({
    status: 'ok',
    checks: { pgvector: expect.stringMatching(/^0\.(8|9)|^[1-9]/) },
  }));
it('is not ready with pending migrations', async () => {
  /* revert last migration → 503, checks.migrations = 'pending migrations' */
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:int -- src/jobs src/modules/instance && pnpm --filter @app/api test:e2e -- test/e2e/health` → FAIL.
- [ ] **Step 3: Implement.** The api process starts pg-boss with `supervise: false, schedule: false` (send-only); the worker starts it fully and subscribes every discovered `@JobProcessor` with `teamSize = concurrency`. `worker.ts`: `loadConfig(process.env)` → `NestFactory.createApplicationContext(WorkerAppModule)`; `SIGTERM` stops pg-boss gracefully (wait ≤ 30 s).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(api): pg-boss job framework, worker entrypoint, heartbeat and readiness check"`

---

### Task 0.17: Schema part B — credentials, bots, knowledge, conversations, traces, usage, prices

**Files:**

- Create entities: `modules/credentials/provider-credential.entity.ts`, `modules/bots/{bot,prompt-version}.entity.ts`, `modules/knowledge/entities/{knowledge-source,document,document-version,chunk}.entity.ts`, `modules/conversations/entities/{contact,conversation,message}.entity.ts`, `modules/traces/generation-trace.entity.ts`, `modules/usage/{usage-daily,model-price}.entity.ts`
- Modify: `packages/shared/src/enums.ts` (all remaining enums from spec §9)
- Create: generated migration `<ts>-schema-core.ts`, hand-written `<ts>-vector-and-search-indexes.ts`
- Test: `apps/api/src/db/schema-core.int.spec.ts`

**Interfaces:**

- Produces: entity classes named `<Name>Entity`; shared enums `SOURCE_TYPES`, `SOURCE_STATUSES`, `DOCUMENT_STATUSES`, `EXTRACTION_WARNINGS = ['js_rendered_suspected','pdf_no_text_layer','truncated','low_text_content']`, `CONVERSATION_STATUSES = ['ai','needs_human','human','closed']`, `HANDOFF_REASONS = ['visitor_request','handoff_intent','no_answer','negative_feedback','agent_takeover']`, `MESSAGE_ROLES`, `MESSAGE_STATUSES`, `TRACE_DECISIONS = ['answered','escalated','refused','error']`, `TRACE_ORIGINS = ['widget','playground']`, `NO_ANSWER_BEHAVIORS`, `PRIORITIES`, `CHANNELS = ['web']`.

- [ ] **Step 1: Write failing schema test**

```ts
it('has all core tables', async () =>
  expect(await tables()).toEqual(
    expect.arrayContaining([
      'provider_credentials',
      'bots',
      'prompt_versions',
      'knowledge_sources',
      'documents',
      'document_versions',
      'chunks',
      'contacts',
      'conversations',
      'messages',
      'generation_traces',
      'usage_daily',
      'model_prices',
    ]),
  ));
it.each([
  'chunks_embedding_384_hnsw',
  'chunks_embedding_768_hnsw',
  'chunks_embedding_1024_hnsw',
  'chunks_embedding_1536_hnsw',
  'chunks_embedding_3072_hnsw_halfvec',
  'chunks_tsv_gin',
  'messages_tsv_gin',
  'conversations_inbox',
  'messages_conversation_created',
  'generation_traces_ws_created',
  'generation_traces_bot_created',
  'generation_traces_decision_created',
  'model_prices_unique',
])('has index %s', async (name) =>
  expect(await ds.query('SELECT 1 FROM pg_indexes WHERE indexname=$1', [name])).toHaveLength(1),
);
it('uses the 384 HNSW index for a bot-filtered query', async () => {
  // insert 1 bot + 200 chunks dim 384; SET enable_seqscan=off; EXPLAIN the spec §13.1 candidate query
  expect(plan).toContain('chunks_embedding_384_hnsw');
});
it('defaults allowed_origins to empty', async () => {
  /* insert bot without origins → '{}' */
});
it('generates tsv columns', async () => {
  /* insert chunk 'Refund window' → tsv @@ to_tsquery('simple','refund') */
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:int -- src/db/schema-core` → FAIL.
- [ ] **Step 3: Write entities** exactly per spec §9.2–§9.5 (v1.1 columns: `pending_embedding_model`, `handoff_message`, `handoff_phrases`, `allowed_link_domains`, `require_challenge`, `document_versions.warnings`, `chunks.metadata`, `messages.tsv`, `generation_traces.origin`, nullable `message_id`). `chunks.embedding`: `type: 'vector'` if supported by the installed TypeORM, else a `text` column with transformer `toVectorLiteral(v: number[]): string` / `fromVectorLiteral(s: string): number[]` (in `src/db/vector.ts`, unit-tested) and the real type set in the hand-written migration; `select: false`. Generated columns via `generatedType: 'STORED'`, `asExpression`. `model_prices`: `id` PK + columns per spec.
- [ ] **Step 4: Generate and hand-write migrations**

Run: `pnpm db:generate --name=schema-core`, review. Hand-written index migration (`transaction = false`, `CREATE INDEX CONCURRENTLY IF NOT EXISTS`):

```sql
CREATE INDEX chunks_embedding_384_hnsw ON chunks USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE embedding_dim = 384;
-- same for 768, 1024, 1536
CREATE INDEX chunks_embedding_3072_hnsw_halfvec ON chunks USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE embedding_dim = 3072;
CREATE INDEX chunks_tsv_gin ON chunks USING gin (tsv);
CREATE INDEX messages_tsv_gin ON messages USING gin (tsv);
CREATE INDEX conversations_inbox ON conversations (workspace_id, status, last_message_at DESC);
CREATE INDEX messages_conversation_created ON messages (conversation_id, created_at);
CREATE INDEX generation_traces_ws_created ON generation_traces (workspace_id, created_at);
CREATE INDEX generation_traces_bot_created ON generation_traces (bot_id, created_at);
CREATE INDEX generation_traces_decision_created ON generation_traces (decision, created_at);
CREATE UNIQUE INDEX model_prices_unique ON model_prices (provider, model, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'));
```

Declare each on its entity with `{ synchronize: false }`.

- [ ] **Step 5: Verify** — `pnpm --filter @app/api test:int -- src/db && pnpm db:migrate && pnpm db:check` → PASS, no drift.
- [ ] **Step 6: Commit** — `git commit -s -m "feat(db): core schema with per-dimension vector indexes and search indexes"`

---

### Task 0.18: Isolation suite skeleton and dependency rules

**Files:**

- Create: `apps/api/test/isolation/{route-inventory.ts,isolation-fixtures.ts,isolation.e2e.spec.ts}`
- Create: `apps/api/.dependency-cruiser.cjs`, `apps/api/test/fixtures/depcruise-cycle/{a.ts,b.ts}`
- Test: `apps/api/test/depcruise.spec.ts`
- Modify: `docs/architecture.md` §4.8 bullet "One entry point" → "Only files in `src/providers/` import `ai`/`@ai-sdk/*`; everything else calls `Llm`."

**Interfaces:**

- Produces:
  - `listRoutes(app: INestApplication): { method: string; path: string }[]` (from Fastify `printRoutes`/route table, normalized to `/api/...` with `:param` names)
  - `ISOLATION_FIXTURES: Record<string, (ctx: IsolationContext) => Promise<string>>` keyed by route param name (`botId`, `credentialId`, …; `workspaceId` is built in) — each creates the resource in workspace A and returns its id
  - `ISOLATION_EXEMPT: { method: string; path: string; reason: string }[]`
  - `IsolationContext = { t: TestApp; wsA: WorkspaceId; userA: …; wsB: WorkspaceId; userB: …; cookiesB: string[] }` (filled in Task 1.18; until then the suite only checks coverage)
  - Script `depcruise` = `depcruise src --config .dependency-cruiser.cjs`

- [ ] **Step 1: Write failing tests**

```ts
it('lists routes', () =>
  expect(listRoutes(t.app)).toEqual(
    expect.arrayContaining([{ method: 'GET', path: '/api/health/live' }]),
  ));
it('covers every workspace-scoped route', () => {
  const uncovered = listRoutes(t.app)
    .filter((r) => r.path.startsWith('/api/v1/workspaces/:workspaceId'))
    .filter((r) => !ISOLATION_EXEMPT.some((e) => e.method === r.method && e.path === r.path))
    .flatMap((r) =>
      paramNames(r.path)
        .filter((p) => p !== 'workspaceId' && !(p in ISOLATION_FIXTURES))
        .map((p) => `${r.method} ${r.path} (:${p})`),
    );
  expect(uncovered).toEqual([]);
});
// depcruise.spec.ts
it('fails on cycles', () =>
  expect(runDepcruise('test/fixtures/depcruise-cycle')).toMatchObject({
    exitCode: 1,
    output: expect.stringContaining('no-circular'),
  }));
it('passes on src', () => expect(runDepcruise('src').exitCode).toBe(0));
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:e2e -- test/isolation && pnpm --filter @app/api test:unit -- test/depcruise` → FAIL.
- [ ] **Step 3: Implement** rules: `no-circular`; `common-is-leaf` (`src/common` → not `src/(db|modules|providers|jobs|app)`); `db-only-common`; `module-public-surface` (from `src/modules/([^/]+)/` to `src/modules/(?!$1)[^/]+/(?!index\.ts$)`); `ai-sdk-in-providers-only` (`^(ai|@ai-sdk/)` only from `src/providers/`); `no-test-imports-in-src`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "test(api): route inventory for isolation suite and dependency-cruiser rules"`

---

### Task 0.19: CI workflows and repository automation

**Files:**

- Create: `.github/workflows/{ci.yml,codeql.yml,scorecard.yml,pr-title.yml}`, `.github/renovate.json`, `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug.yml,feature.yml,provider.yml,docs.yml,config.yml}`

- [ ] **Step 1: Write `ci.yml`**

Triggers: `pull_request`, `push` to `main`. `permissions: contents: read`. Jobs (all `ubuntu-24.04`, `pnpm/action-setup` + `actions/setup-node` with `node-version-file: .nvmrc`, `cache: pnpm`, Turborepo cache via `actions/cache` on `.turbo`):

1. `lint` — `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm --filter @app/api depcruise`.
2. `typecheck` — `pnpm typecheck`.
3. `unit` — `pnpm --filter @app/eslint-config test`, `pnpm --filter @app/api test:unit`.
4. `integration` — restore `apps/api/models` cache keyed on `hashFiles('apps/api/models/manifest.json')`, `pnpm --filter @app/api fetch-model`, `pnpm --filter @app/api test:int`, `pnpm --filter @app/api test:e2e`.
5. `db-check` — service `pgvector/pgvector:pg18`; `pnpm db:migrate && pnpm db:check`.
6. `build` — `pnpm build`.
7. `reuse` — `fsfe/reuse-action`.
8. `audit` — `pnpm audit --prod --audit-level critical`; `pnpm licenses list --prod --json | node scripts/check-licenses.mjs` (fails on licenses outside the allowlist in architecture §6.1; `scripts/check-licenses.mjs` + its unit test are part of this step).
   Later tasks append `docker` (0.20), `e2e-browser` (1.19), `size` (5.8), `rag` (4.11).

- [ ] **Step 2: Write the other workflows and configs**

`codeql.yml` (javascript-typescript, PR + weekly), `scorecard.yml` (weekly, publishes results, `id-token: write`), `pr-title.yml` (`amannn/action-semantic-pull-request`), `renovate.json` (`extends: ["config:recommended", "helpers:pinGitHubActionDigests"]`, `minimumReleaseAge: "7 days"`, package rules grouping `ai` + `@ai-sdk/*`, `@nestjs/*`, `@tanstack/*`, `typescript-eslint` + `eslint*`), `CODEOWNERS` (`* @<owner>`), PR template = architecture §7.7 checklist, issue forms with required fields (version, deployment method, logs for bug; provider name + docs link for provider).

- [ ] **Step 3: Pin actions and lint workflows**

Run: `pinact run && actionlint`
Expected: every `uses:` pinned to a SHA with a version comment; actionlint reports nothing.

- [ ] **Step 4: Push and verify**

Run: `gh repo create <org>/<repo> --public --source . --push` (owner confirms visibility first), then open a PR from a branch.
Expected: all CI jobs green.

- [ ] **Step 5: Repository settings (owner runs, documented in `CONTRIBUTING.md`)**

Enable private vulnerability reporting, Discussions, squash-merge only, install the DCO GitHub App, and protect `main`:
`gh api -X PUT repos/<org>/<repo>/branches/main/protection --input deploy/github-branch-protection.json` (required checks = the CI job names above, linear history, 1 review, no force pushes).

- [ ] **Step 6: Commit** — `git commit -s -m "ci: add ci, codeql, scorecard, pr title check, renovate and templates"`

---

### Task 0.20: Docker images, production compose, Caddy

**Files:**

- Create: `apps/api/Dockerfile`, `apps/api/src/migrate.ts`, `apps/api/src/cli/worker-health.ts`, `deploy/web.Dockerfile`, `deploy/Caddyfile`, `deploy/docker-compose.yml`, `.dockerignore`
- Modify: `.github/workflows/ci.yml` (add `docker` job)
- Test: `deploy/smoke.sh`

**Interfaces:**

- Produces: images `ghcr.io/<org>/ailoom-api` (entrypoints `node dist/main.js` | `node dist/worker.js` | `node dist/migrate.js`) and `ghcr.io/<org>/ailoom-web`; compose services `web`, `api`, `worker`, `migrate`, `postgres`, profile `ollama`.

- [ ] **Step 1: Write `apps/api/Dockerfile`**

Stages: `deps` (`node:24-slim`, `corepack enable`, `pnpm fetch`), `build` (`pnpm install --offline --frozen-lockfile --filter @app/api...`, `pnpm --filter @app/api build`, `pnpm --filter @app/api fetch-model`, `pnpm deploy --filter @app/api --prod /out`), `runtime` (`node:24-slim`, copy `/out` and `models/`, `ENV NODE_ENV=production`, `USER node`, `EXPOSE 3000`, `HEALTHCHECK` none — compose defines per service).
`migrate.ts`: `loadConfig(process.env)` → `new DataSource(buildDataSourceOptions(...)).initialize()` → `runMigrations({ transaction: 'each' })` → log count → exit 0; any error → exit 1.
`worker-health.ts`: exits 0 if a `worker_heartbeats` row is newer than 90 s.

- [ ] **Step 2: Write `deploy/web.Dockerfile` and `Caddyfile`**

web: build stage `pnpm --filter @app/admin build` → `caddy:2-alpine`, copy `apps/admin/dist` to `/srv/admin`, `deploy/Caddyfile` to `/etc/caddy/Caddyfile`.
Caddyfile site `{$PUBLIC_URL}`:

- `handle /api/*` → `reverse_proxy api:3000 { flush_interval -1 }`
- `handle /widget.js` and `handle /widget/*` → `reverse_proxy api:3000`
- `handle` (default) → `root * /srv/admin`, `try_files {path} /index.html`, `file_server`, `encode zstd gzip`, headers `Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"`, `X-Frame-Options DENY`, `Cross-Origin-Resource-Policy same-origin`, `Referrer-Policy strict-origin-when-cross-origin`, `X-Content-Type-Options nosniff`
- `header Strict-Transport-Security "max-age=31536000; includeSubDomains"` only when the site is HTTPS (use a named matcher on `{scheme}`).

- [ ] **Step 3: Write `deploy/docker-compose.yml`**

Per spec §22.1 and architecture §3.1: `postgres` (`pgvector/pgvector:pg18`, healthcheck `pg_isready`, volume `postgres_data`), `migrate` (api image, `command: ["node","dist/migrate.js"]`, `depends_on: postgres: service_healthy`, `restart: "no"`), `api` (`depends_on: migrate: service_completed_successfully`, volume `files_data:/data/files`, `extra_hosts: ["host.docker.internal:host-gateway"]`, healthcheck `node -e "fetch('http://localhost:3000/api/health/live').then(r=>process.exit(r.ok?0:1))"`), `worker` (same deps/volumes/extra_hosts, `command: ["node","dist/worker.js"]`, healthcheck `node dist/cli/worker-health.js`), `web` (ports `${HTTP_PORT:-80}:${HTTP_PORT:-80}` and `443:443`, volumes `caddy_data`, `caddy_config`, `depends_on: api: service_healthy`), `ollama` (`profiles: ["ollama"]`, `ollama/ollama`, volume `ollama_data`). All app services `env_file: .env`. Each service has `build:` pointing at the Dockerfiles so `--build` works from a checkout, and `image:` with `${VERSION:-latest}`.

- [ ] **Step 4: Write and run the smoke test**

`deploy/smoke.sh`: `docker compose -f deploy/docker-compose.yml up -d --build --wait`; asserts `curl -fsS $PUBLIC_URL/api/health/live` = `{"status":"ok"}`, `/api/health/ready` returns 200, `curl -fsS $PUBLIC_URL/` contains `<div id="root">`, `docker compose exec -T api id -u` ≠ `0`, response of `/` has `content-security-policy`; tears down with `down -v`.
Run: `PUBLIC_URL=http://localhost:8080 HTTP_PORT=8080 bash deploy/smoke.sh`
Expected: `smoke: ok`.

- [ ] **Step 5: Add CI `docker` job** — builds both images with `docker/build-push-action` (`push: false`), then runs `deploy/smoke.sh`.
- [ ] **Step 6: Commit** — `git commit -s -m "build: production images, compose stack and caddy single-origin routing"`

---

### Task 0.21: Docs site and ADRs

**Files:**

- Create: `apps/docs/` (Starlight project), `apps/docs/src/content/docs/{index.mdx,getting-started.md,self-hosting.md,configuration.md,providers/index.md,architecture.md}`
- Create: `docs/adr/000-template.md` … `docs/adr/010-local-embeddings.md`
- Create: `.github/workflows/docs.yml`

- [ ] **Step 1: Scaffold Starlight**

Run: `pnpm create astro@latest apps/docs -- --template starlight --no-install --no-git` then set `name: "@app/docs"`, `license: "AGPL-3.0-only"` (content is CC-BY via REUSE.toml), add `starlight-links-validator`.

- [ ] **Step 2: Write ADRs**

`000-template.md` = MADR (Context, Decision, Consequences, Status). One file per ADR-001…ADR-010 from spec §8, content copied from the spec bullet, status `Accepted`, date `2026-11-09`.

- [ ] **Step 3: Write stub pages**

Each page has a title, one paragraph, and a "Coming in v0.1.0" list of what it will cover (filled in Task 7.9). `architecture.md` embeds the SVGs from `docs/assets/` (copy them into `apps/docs/src/assets/` via a `prebuild` script, not by hand).

- [ ] **Step 4: Build and verify**

Run: `pnpm --filter @app/docs build`
Expected: build succeeds, links validator reports 0 broken links.

- [ ] **Step 5: Add `docs.yml`** — on push to `main` touching `apps/docs/**` or `docs/**`: build and deploy to GitHub Pages (`actions/upload-pages-artifact`, `actions/deploy-pages`, `pages: write`, `id-token: write`).
- [ ] **Step 6: Commit and tag**

```bash
git add -A
git commit -s -m "docs: starlight docs site and architecture decision records"
git tag m0-done
```
