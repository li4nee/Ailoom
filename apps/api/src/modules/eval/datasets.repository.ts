// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type {
  CreateEvalDatasetRequest,
  EvalCaseInput,
  UpdateEvalCaseRequest,
  UpdateEvalDatasetRequest,
} from '@app/shared';
import { evalCaseInputSchema } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { decodeCursor, encodeCursor } from '../../db/pagination';

interface DatasetRow {
  id: string;
  bot_id: string;
  name: string;
  description: string | null;
  allow_partial: boolean;
  created_at: Date;
  updated_at: Date;
  case_count?: number;
}

interface CaseRow {
  id: string;
  dataset_id: string;
  question: string;
  history: { role: 'visitor' | 'ai'; content: string }[];
  expected_answer: string | null;
  expected_document_ids: string[];
  must_include: string[];
  must_not_include: string[];
  expect_handoff: boolean | null;
  needs_expectation: boolean;
  origin: EvalCaseInput['origin'];
  origin_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowsFromReturning<T>(result: T[] | [T[], number]): T[] {
  const first = result[0] as T | T[] | undefined;
  return Array.isArray(first) ? first : (result as T[]);
}

export function datasetDto(row: DatasetRow) {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    description: row.description,
    allowPartial: row.allow_partial,
    ...(row.case_count === undefined ? {} : { caseCount: row.case_count }),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function caseDto(row: CaseRow) {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    question: row.question,
    history: row.history,
    expectedAnswer: row.expected_answer,
    expectedDocumentIds: row.expected_document_ids,
    mustInclude: row.must_include,
    mustNotInclude: row.must_not_include,
    expectHandoff: row.expect_handoff,
    needsExpectation: row.needs_expectation,
    origin: row.origin,
    originRef: row.origin_ref,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

@Injectable()
export class DatasetsRepository {
  constructor(private readonly ds: DataSource) {}

  async botExists(workspaceId: WorkspaceId, botId: string, manager = this.ds.manager) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM bots WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [workspaceId, botId],
    );
    return rows[0] !== undefined;
  }

  async datasetExists(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    manager = this.ds.manager,
  ) {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM eval_datasets WHERE workspace_id = $1 AND bot_id = $2 AND id = $3`,
      [workspaceId, botId, datasetId],
    );
    return rows[0] !== undefined;
  }

  async listDatasets(workspaceId: WorkspaceId, botId: string, manager = this.ds.manager) {
    return manager.query<DatasetRow[]>(
      `SELECT d.id, d.bot_id, d.name, d.description, d.allow_partial, d.created_at, d.updated_at,
              count(c.id)::int AS case_count
         FROM eval_datasets d LEFT JOIN eval_cases c ON c.dataset_id = d.id
        WHERE d.workspace_id = $1 AND d.bot_id = $2
        GROUP BY d.id ORDER BY d.created_at DESC, d.id DESC`,
      [workspaceId, botId],
    );
  }

  async getDataset(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    manager = this.ds.manager,
  ) {
    const rows = await manager.query<DatasetRow[]>(
      `SELECT id, bot_id, name, description, allow_partial, created_at, updated_at
         FROM eval_datasets WHERE workspace_id = $1 AND bot_id = $2 AND id = $3`,
      [workspaceId, botId, datasetId],
    );
    return rows[0] ?? null;
  }

  async createDataset(
    workspaceId: WorkspaceId,
    botId: string,
    userId: string,
    input: CreateEvalDatasetRequest,
    manager: EntityManager,
  ) {
    const rows = await manager.query<DatasetRow[]>(
      `INSERT INTO eval_datasets (workspace_id, bot_id, name, description, allow_partial, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, bot_id, name, description, allow_partial, created_at, updated_at`,
      [workspaceId, botId, input.name, input.description ?? null, input.allowPartial, userId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Eval dataset insert did not return a row.');
    return row;
  }

  async updateDataset(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    input: UpdateEvalDatasetRequest,
    manager: EntityManager,
  ) {
    const result = await manager.query<DatasetRow[] | [DatasetRow[], number]>(
      `UPDATE eval_datasets SET
         name = COALESCE($4, name), description = CASE WHEN $5 THEN $6 ELSE description END,
         allow_partial = COALESCE($7, allow_partial), updated_at = now()
       WHERE workspace_id = $1 AND bot_id = $2 AND id = $3
       RETURNING id, bot_id, name, description, allow_partial, created_at, updated_at`,
      [
        workspaceId,
        botId,
        datasetId,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.allowPartial ?? null,
      ],
    );
    return rowsFromReturning(result)[0] ?? null;
  }

  async deleteDataset(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    manager: EntityManager,
  ) {
    const result = await manager.query<{ id: string }[] | [{ id: string }[], number]>(
      `DELETE FROM eval_datasets WHERE workspace_id = $1 AND bot_id = $2 AND id = $3 RETURNING id`,
      [workspaceId, botId, datasetId],
    );
    return rowsFromReturning(result)[0] !== undefined;
  }

  async listCases(workspaceId: WorkspaceId, datasetId: string, limit: number, cursor?: string) {
    const cursorId = cursor === undefined ? null : decodeCursor(cursor);
    if (cursorId !== null) {
      const belongs = await this.ds.query<{ id: string }[]>(
        `SELECT id FROM eval_cases WHERE workspace_id = $1 AND dataset_id = $2 AND id = $3`,
        [workspaceId, datasetId, cursorId],
      );
      if (belongs[0] === undefined) throw new AppError('validation_failed');
    }
    const rows = await this.ds.query<CaseRow[]>(
      `SELECT id, dataset_id, question, history, expected_answer, expected_document_ids,
              must_include, must_not_include, expect_handoff, needs_expectation, origin, origin_ref,
              created_at, updated_at
         FROM eval_cases
        WHERE workspace_id = $1 AND dataset_id = $2 AND ($3::uuid IS NULL OR id < $3)
        ORDER BY id DESC LIMIT $4`,
      [workspaceId, datasetId, cursorId, limit + 1],
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: pageRows.map(caseDto),
      nextCursor: hasMore ? encodeCursor(pageRows.at(-1)?.id ?? '') : null,
    };
  }

  async countCases(workspaceId: WorkspaceId, datasetId: string, manager = this.ds.manager) {
    const rows = await manager.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM eval_cases WHERE workspace_id = $1 AND dataset_id = $2`,
      [workspaceId, datasetId],
    );
    return rows[0]?.count ?? 0;
  }

  async createCase(
    workspaceId: WorkspaceId,
    datasetId: string,
    input: EvalCaseInput,
    manager: EntityManager,
  ) {
    const result = await manager.query<CaseRow[] | [CaseRow[], number]>(
      `INSERT INTO eval_cases (
         workspace_id, dataset_id, question, history, expected_answer, expected_document_ids,
         must_include, must_not_include, expect_handoff, needs_expectation, origin, origin_ref
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, dataset_id, question, history, expected_answer, expected_document_ids,
                 must_include, must_not_include, expect_handoff, needs_expectation, origin, origin_ref,
                 created_at, updated_at`,
      [
        workspaceId,
        datasetId,
        input.question,
        JSON.stringify(input.history),
        input.expectedAnswer ?? null,
        input.expectedDocumentIds,
        input.mustInclude,
        input.mustNotInclude,
        input.expectHandoff ?? null,
        input.needsExpectation,
        input.origin,
        input.originRef ?? null,
      ],
    );
    const row = rowsFromReturning(result)[0];
    if (row === undefined) throw new Error('Eval case insert did not return a row.');
    return row;
  }

  async updateCase(
    workspaceId: WorkspaceId,
    caseId: string,
    input: UpdateEvalCaseRequest,
    manager: EntityManager,
  ) {
    const current = await manager.query<CaseRow[]>(
      `SELECT id, dataset_id, question, history, expected_answer, expected_document_ids,
              must_include, must_not_include, expect_handoff, needs_expectation, origin, origin_ref,
              created_at, updated_at FROM eval_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, caseId],
    );
    const row = current[0];
    if (row === undefined) return null;
    const merged = {
      question: input.question ?? row.question,
      history: input.history ?? row.history,
      expectedAnswer:
        (input.expectedAnswer === undefined ? row.expected_answer : input.expectedAnswer) ??
        undefined,
      expectedDocumentIds: input.expectedDocumentIds ?? row.expected_document_ids,
      mustInclude: input.mustInclude ?? row.must_include,
      mustNotInclude: input.mustNotInclude ?? row.must_not_include,
      expectHandoff: input.expectHandoff === undefined ? row.expect_handoff : input.expectHandoff,
      needsExpectation: input.needsExpectation ?? row.needs_expectation,
    };
    const valid = evalCaseInputSchema.safeParse({
      ...merged,
      origin: row.origin,
      originRef: row.origin_ref,
    });
    if (!valid.success) {
      throw new AppError('validation_failed', {
        details: valid.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    const updated = await manager.query<CaseRow[] | [CaseRow[], number]>(
      `UPDATE eval_cases SET question = $3, history = $4::jsonb, expected_answer = $5,
         expected_document_ids = $6, must_include = $7, must_not_include = $8,
         expect_handoff = $9, needs_expectation = $10, updated_at = now()
       WHERE workspace_id = $1 AND id = $2
       RETURNING id, dataset_id, question, history, expected_answer, expected_document_ids,
                 must_include, must_not_include, expect_handoff, needs_expectation, origin, origin_ref,
                 created_at, updated_at`,
      [
        workspaceId,
        caseId,
        valid.data.question,
        JSON.stringify(valid.data.history),
        valid.data.expectedAnswer ?? null,
        valid.data.expectedDocumentIds,
        valid.data.mustInclude,
        valid.data.mustNotInclude,
        valid.data.expectHandoff ?? null,
        valid.data.needsExpectation,
      ],
    );
    return rowsFromReturning(updated)[0] ?? null;
  }

  async deleteCase(workspaceId: WorkspaceId, caseId: string, manager: EntityManager) {
    const result = await manager.query<{ id: string }[] | [{ id: string }[], number]>(
      `DELETE FROM eval_cases WHERE workspace_id = $1 AND id = $2 RETURNING id`,
      [workspaceId, caseId],
    );
    return rowsFromReturning(result)[0] !== undefined;
  }

  async documentsByTitle(workspaceId: WorkspaceId, botId: string) {
    const rows = await this.ds.query<{ id: string; title: string }[]>(
      `SELECT id, title FROM documents WHERE workspace_id = $1 AND bot_id = $2 AND title IS NOT NULL`,
      [workspaceId, botId],
    );
    return new Map(rows.map((row) => [row.title, row.id]));
  }
}
