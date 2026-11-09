# ADR-001: TypeORM, used in a disciplined way

Date: 2026-11-09

Status: Accepted

## Context

The application needs an ORM for database access with first-class NestJS integration. TypeORM is the natural choice given `@nestjs/typeorm`.

## Decision

Use TypeORM 0.3.x with the following rules:

- `synchronize: false` in **every** environment, including dev and tests. Schema changes only via migrations.
- One `DataSource` definition (`apps/api/src/db/data-source.ts`) shared by the app, the CLI, and tests, so app and migration config cannot drift.
- Migrations are generated with `migration:generate`, then **reviewed and edited by hand** before commit. CI fails if `migration:generate --check` (dry run) detects entity changes without a migration.
- **pgvector:** the `embedding` column is declared on the entity with `type: 'vector'` where the installed TypeORM version supports it; otherwise as a `text`-mapped column with a transformer, with the real column type created in a hand-written migration. Either way the vector is never selected by default (`select: false`).
- **Vector indexes** (partial HNSW per dimension) are created in hand-written migration SQL and declared on the entity with `@Index('name', { synchronize: false })` so `migration:generate` never tries to drop them.
- **Vector search and other hot queries** (retrieval, usage rollup upserts, inbox listing) use `QueryBuilder` or parameterized raw SQL in dedicated repository classes, never string concatenation.
- Generated columns (`chunks.tsv`, `messages.tsv`) use TypeORM's `generatedType: 'STORED'` + `asExpression`.
- Primary keys are UUIDv7 generated **by Postgres 18** (`@PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })`). When the app needs an id before insert, it generates a v7 id with the `uuid` package.
- Tenant scoping: tenant tables are accessed only through repositories extending `TenantRepository<T>`, whose methods **require** `workspaceId`. A custom ESLint rule forbids calling generic `Repository` finders on tenant entities outside `*.repository.ts` files.

## Consequences

- Schema changes are explicit and reviewable through migrations.
- The app and migration configuration cannot drift because they share one `DataSource`.
- Vector operations require hand-written migration SQL, which adds operational complexity but ensures correct index types.
- Tenant isolation is enforced at the repository layer with ESLint automation.
