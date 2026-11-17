# Contributing to ailoom

Thanks for helping. This guide covers setup, the workflow, and what makes a pull request mergeable. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js 24 (`.nvmrc` pins it)
- pnpm 12, installed through Corepack (`corepack enable`; the exact version is pinned in `package.json`)
- Docker, for the local database and the integration tests

## Setup

```bash
git clone https://github.com/li4nee/ailoom.git && cd ailoom
corepack enable && pnpm install
cp .env.example .env && pnpm secrets:generate   # paste the output into .env
docker compose -f deploy/docker-compose.dev.yml up -d
pnpm db:migrate && pnpm dev       # api on :3000 + admin dev server
pnpm --filter @app/api dev:worker  # background jobs, in a second terminal
```

The repository is organized as a pnpm workspace. The commands below describe the current public
development setup; run them from the repository root.

## Repository tour

| Path                     | What it is                                    | License           |
| ------------------------ | --------------------------------------------- | ----------------- |
| `apps/api`               | NestJS API server and background worker       | AGPL-3.0-only     |
| `apps/admin`             | Admin single-page app                         | AGPL-3.0-only     |
| `apps/docs`              | Documentation site                            | content CC-BY-4.0 |
| `packages/widget`        | Embeddable chat widget                        | MIT               |
| `packages/shared`        | Zod schemas, API and event types, error codes | MIT               |
| `packages/eslint-config` | Shared ESLint config and custom rules         | MIT               |
| `packages/tsconfig`      | Shared TypeScript configs                     | MIT               |
| `docs/`                  | Specification, architecture, and ADRs         | AGPL-3.0-only     |

See [LICENSING.md](LICENSING.md) for why the licenses differ. MIT packages must never import from `apps/*`.

## Commits and sign-off

- Use [Conventional Commits](https://www.conventionalcommits.org): `feat(widget): offer handoff on intent phrases`. The scope is a package or module name.
- Sign every commit with `git commit -s`. This adds a `Signed-off-by` line and certifies the [Developer Certificate of Origin](https://developercertificate.org). There is no CLA.
- Branch names are `type/short-description`, for example `feat/widget-handoff-offer`. Work happens on short-lived branches off `main`, and pull requests are squash-merged. The pull request title must be a valid Conventional Commit.

## Running tests

| Command                                       | Runs                                                 |
| --------------------------------------------- | ---------------------------------------------------- |
| `pnpm --filter @app/api test:unit <path>`     | `*.spec.ts` (no database)                            |
| `pnpm --filter @app/api test:int <path>`      | `*.int.spec.ts` (Testcontainers Postgres)            |
| `pnpm --filter @app/api test:e2e <path>`      | `test/e2e/**/*.e2e.spec.ts` (Nest app and Postgres)  |
| `pnpm --filter @app/admin test <path>`        | admin unit and component tests                       |
| `pnpm --filter @app/widget test <path>`       | widget unit tests                                    |
| `pnpm --filter @app/eslint-config test`       | custom lint rule tests                               |
| `pnpm e2e`                                    | Playwright against the production-like compose stack |
| `pnpm lint` · `pnpm typecheck` · `pnpm build` | whole repository via Turborepo                       |

Integration tests use a real Postgres through Testcontainers, so Docker must be running. Tests never touch the real network.

## Common changes

- **Add a migration:** generate it with `pnpm db:generate <Name>`, review the SQL, and keep one concern per migration. Migrations are forward-only in production. See [architecture §7.5](docs/architecture.md#75-database-and-migrations).
- **Add a provider:** provider code lives only under `apps/api/src/providers/`. See [architecture §4.8](docs/architecture.md#48-provider-layer).
- **Add an ADR:** copy `docs/adr/000-template.md` to the next number and propose it in a pull request. See [architecture §8.3](docs/architecture.md#83-decisions).

## What makes a pull request mergeable

- CI is green: lint, types, tests, build, license checks, and REUSE.
- New behavior has tests at the lowest layer that can prove it. A bug fix has a regression test.
- User-facing changes update the docs. Configuration changes update `.env.example`.
- An architectural change adds or updates an ADR.
- No secrets, personal data, or message content in logs.
- Commits follow Conventional Commits and are signed off.
- Each new runtime dependency is justified in the pull request description: what it is, why it is needed, its license, and its size.

The full coding standards are in [architecture §7](docs/architecture.md#7-coding-standards), and the contribution workflow and release process are in [architecture §8](docs/architecture.md#8-contribution-workflow-releases-governance).

## Reporting problems

Questions go to [Discussions](https://github.com/li4nee/ailoom/discussions), bugs to [issues](https://github.com/li4nee/ailoom/issues), and security problems to [SECURITY.md](SECURITY.md).
