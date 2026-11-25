// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EvalSuite1794620000000 implements MigrationInterface {
  name = 'EvalSuite1794620000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."trace_origin" ADD VALUE 'eval'`);
    await queryRunner.query(`ALTER TABLE "bots" ADD "eval_gate" jsonb`);
    await queryRunner.query(
      `CREATE TYPE "public"."eval_run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."eval_case_origin" AS ENUM ('manual', 'correction', 'feedback', 'import')`,
    );
    await queryRunner.query(
      `CREATE TABLE "eval_datasets" (
         "id" uuid NOT NULL DEFAULT uuidv7(),
         "workspace_id" uuid NOT NULL,
         "bot_id" uuid NOT NULL,
         "name" varchar(100) NOT NULL,
         "description" text,
         "allow_partial" boolean NOT NULL DEFAULT false,
         "created_by" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         "updated_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "eval_datasets_pk" PRIMARY KEY ("id"),
         CONSTRAINT "eval_datasets_name_check" CHECK (char_length("name") BETWEEN 1 AND 100),
         CONSTRAINT "eval_datasets_workspace_fkey"
           FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_datasets_bot_fkey"
           FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_datasets_created_by_fkey"
           FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "eval_datasets_bot_name_key" ON "eval_datasets" ("bot_id", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "eval_datasets_workspace_id" ON "eval_datasets" ("workspace_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "eval_cases" (
         "id" uuid NOT NULL DEFAULT uuidv7(),
         "workspace_id" uuid NOT NULL,
         "dataset_id" uuid NOT NULL,
         "question" varchar(2000) NOT NULL,
         "history" jsonb NOT NULL DEFAULT '[]'::jsonb,
         "expected_answer" varchar(4000),
         "expected_document_ids" uuid[] NOT NULL DEFAULT '{}',
         "must_include" text[] NOT NULL DEFAULT '{}',
         "must_not_include" text[] NOT NULL DEFAULT '{}',
         "expect_handoff" boolean,
         "needs_expectation" boolean NOT NULL DEFAULT false,
         "origin" "public"."eval_case_origin" NOT NULL DEFAULT 'manual',
         "origin_ref" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         "updated_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "eval_cases_pk" PRIMARY KEY ("id"),
         CONSTRAINT "eval_cases_question_check" CHECK (char_length("question") BETWEEN 1 AND 2000),
         CONSTRAINT "eval_cases_expected_answer_check"
           CHECK ("expected_answer" IS NULL OR char_length("expected_answer") <= 4000),
         CONSTRAINT "eval_cases_expectation_check" CHECK (
           "needs_expectation" OR "expected_answer" IS NOT NULL OR
           cardinality("expected_document_ids") > 0 OR cardinality("must_include") > 0 OR
           cardinality("must_not_include") > 0 OR "expect_handoff" IS NOT NULL
         ),
         CONSTRAINT "eval_cases_workspace_fkey"
           FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_cases_dataset_fkey"
           FOREIGN KEY ("dataset_id") REFERENCES "eval_datasets"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "eval_cases_workspace_dataset_created"
         ON "eval_cases" ("workspace_id", "dataset_id", "created_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "eval_runs" (
         "id" uuid NOT NULL DEFAULT uuidv7(),
         "workspace_id" uuid NOT NULL,
         "bot_id" uuid NOT NULL,
         "dataset_id" uuid NOT NULL,
         "status" "public"."eval_run_status" NOT NULL DEFAULT 'queued',
         "config" jsonb NOT NULL,
         "cases_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
         "cases_total" integer NOT NULL DEFAULT 0,
         "cases_done" integer NOT NULL DEFAULT 0,
         "summary" jsonb,
         "baseline_run_id" uuid,
         "cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
         "error" text,
         "created_by" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         "started_at" timestamptz,
         "finished_at" timestamptz,
         CONSTRAINT "eval_runs_pk" PRIMARY KEY ("id"),
         CONSTRAINT "eval_runs_counts_check"
           CHECK ("cases_total" >= 0 AND "cases_done" >= 0 AND "cases_done" <= "cases_total"),
         CONSTRAINT "eval_runs_cost_check" CHECK ("cost_usd" >= 0),
         CONSTRAINT "eval_runs_workspace_fkey"
           FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_runs_bot_fkey"
           FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_runs_dataset_fkey"
           FOREIGN KEY ("dataset_id") REFERENCES "eval_datasets"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_runs_baseline_fkey"
           FOREIGN KEY ("baseline_run_id") REFERENCES "eval_runs"("id") ON DELETE SET NULL,
         CONSTRAINT "eval_runs_created_by_fkey"
           FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "eval_runs_workspace_dataset_created"
         ON "eval_runs" ("workspace_id", "dataset_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "eval_runs_workspace_bot_status"
         ON "eval_runs" ("workspace_id", "bot_id", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "eval_results" (
         "id" uuid NOT NULL DEFAULT uuidv7(),
         "workspace_id" uuid NOT NULL,
         "run_id" uuid NOT NULL,
         "case_id" uuid,
         "trace_id" uuid,
         "decision" "public"."trace_decision" NOT NULL,
         "answer" text NOT NULL DEFAULT '',
         "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
         "retrieved" jsonb NOT NULL DEFAULT '[]'::jsonb,
         "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
         "passed" boolean NOT NULL DEFAULT false,
         "error" text,
         "latency_ms" integer,
         "cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "eval_results_pk" PRIMARY KEY ("id"),
         CONSTRAINT "eval_results_cost_check" CHECK ("cost_usd" >= 0),
         CONSTRAINT "eval_results_latency_check" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
         CONSTRAINT "eval_results_workspace_fkey"
           FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_results_run_fkey"
           FOREIGN KEY ("run_id") REFERENCES "eval_runs"("id") ON DELETE CASCADE,
         CONSTRAINT "eval_results_case_fkey"
           FOREIGN KEY ("case_id") REFERENCES "eval_cases"("id") ON DELETE SET NULL,
         CONSTRAINT "eval_results_trace_fkey"
           FOREIGN KEY ("trace_id") REFERENCES "generation_traces"("id") ON DELETE SET NULL,
         CONSTRAINT "eval_results_run_case_key" UNIQUE ("run_id", "case_id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "eval_results_workspace_run_created"
         ON "eval_results" ("workspace_id", "run_id", "created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."eval_results_workspace_run_created"`);
    await queryRunner.query(`DROP TABLE "eval_results"`);
    await queryRunner.query(`DROP INDEX "public"."eval_runs_workspace_bot_status"`);
    await queryRunner.query(`DROP INDEX "public"."eval_runs_workspace_dataset_created"`);
    await queryRunner.query(`DROP TABLE "eval_runs"`);
    await queryRunner.query(`DROP INDEX "public"."eval_cases_workspace_dataset_created"`);
    await queryRunner.query(`DROP TABLE "eval_cases"`);
    await queryRunner.query(`DROP INDEX "public"."eval_datasets_workspace_id"`);
    await queryRunner.query(`DROP INDEX "public"."eval_datasets_bot_name_key"`);
    await queryRunner.query(`DROP TABLE "eval_datasets"`);
    await queryRunner.query(`DROP TYPE "public"."eval_case_origin"`);
    await queryRunner.query(`DROP TYPE "public"."eval_run_status"`);
    await queryRunner.query(`ALTER TABLE "bots" DROP COLUMN "eval_gate"`);

    // Preserve the existing enum labels when removing eval. Eval traces are non-persistent
    // attempts just like playground traces, so downgrade them to the nearest retained origin.
    await queryRunner.query(`ALTER TYPE "public"."trace_origin" RENAME TO "trace_origin_old"`);
    await queryRunner.query(
      `CREATE TYPE "public"."trace_origin" AS ENUM ('widget', 'playground', 'agent_assist')`,
    );
    await queryRunner.query(
      `ALTER TABLE "generation_traces" ALTER COLUMN "origin" TYPE "public"."trace_origin"
         USING (CASE WHEN "origin"::text = 'eval' THEN 'playground' ELSE "origin"::text END)::"public"."trace_origin"`,
    );
    await queryRunner.query(`DROP TYPE "public"."trace_origin_old"`);
  }
}
