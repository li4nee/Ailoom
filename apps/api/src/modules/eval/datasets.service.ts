// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  CreateEvalDatasetRequest,
  EvalCaseInput,
  UpdateEvalCaseRequest,
  UpdateEvalDatasetRequest,
} from '@app/shared';

import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import { caseDto, datasetDto, DatasetsRepository } from './datasets.repository';
import { casesForExport, importRagFixtures, parseEvalImport } from './import-export';

const MAX_DATASET_CASES = 500;
const MAX_CASES_PER_REQUEST = 100;

@Injectable()
export class DatasetsService {
  constructor(
    private readonly ds: DataSource,
    private readonly datasets: DatasetsRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
  ) {}

  async list(workspaceId: WorkspaceId, botId: string) {
    await this.requireBot(workspaceId, botId);
    return (await this.datasets.listDatasets(workspaceId, botId)).map(datasetDto);
  }

  async create(
    workspaceId: WorkspaceId,
    botId: string,
    userId: UserId,
    input: CreateEvalDatasetRequest,
  ) {
    await this.requireBot(workspaceId, botId);
    return this.ds.transaction(async (manager) => {
      const row = await this.datasets.createDataset(workspaceId, botId, userId, input, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.dataset_created',
          targetType: 'eval_dataset',
          targetId: row.id,
          metadata: { botId, name: row.name },
        },
        manager,
      );
      return datasetDto(row);
    });
  }

  async update(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    userId: UserId,
    input: UpdateEvalDatasetRequest,
  ) {
    await this.requireDataset(workspaceId, botId, datasetId);
    return this.ds.transaction(async (manager) => {
      const row = await this.datasets.updateDataset(workspaceId, botId, datasetId, input, manager);
      if (row === null) throw new AppError('not_found');
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.dataset_updated',
          targetType: 'eval_dataset',
          targetId: datasetId,
          metadata: { botId, changes: Object.keys(input) },
        },
        manager,
      );
      return datasetDto(row);
    });
  }

  async delete(workspaceId: WorkspaceId, botId: string, datasetId: string, userId: UserId) {
    await this.requireDataset(workspaceId, botId, datasetId);
    await this.ds.transaction(async (manager) => {
      if (!(await this.datasets.deleteDataset(workspaceId, botId, datasetId, manager))) {
        throw new AppError('not_found');
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.dataset_deleted',
          targetType: 'eval_dataset',
          targetId: datasetId,
          metadata: { botId },
        },
        manager,
      );
    });
    return { deleted: true };
  }

  async listCases(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    query: { limit: number; cursor?: string },
  ) {
    await this.requireDataset(workspaceId, botId, datasetId);
    return this.datasets.listCases(workspaceId, datasetId, query.limit, query.cursor);
  }

  async createCases(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    userId: UserId,
    inputs: EvalCaseInput[],
  ) {
    await this.requireDataset(workspaceId, botId, datasetId);
    if (inputs.length === 0 || inputs.length > MAX_CASES_PER_REQUEST) {
      throw new AppError('validation_failed', {
        details: [
          { path: 'cases', message: `Provide 1 to ${String(MAX_CASES_PER_REQUEST)} cases.` },
        ],
      });
    }
    return this.ds.transaction(async (manager) => {
      const currentCount = await this.datasets.countCases(workspaceId, datasetId, manager);
      if (currentCount + inputs.length > MAX_DATASET_CASES) {
        throw new AppError('validation_failed', {
          details: [{ path: 'cases', message: 'A dataset can contain at most 500 cases.' }],
        });
      }
      const created = [];
      for (const input of inputs) {
        created.push(
          caseDto(await this.datasets.createCase(workspaceId, datasetId, input, manager)),
        );
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.case_created',
          targetType: 'eval_dataset',
          targetId: datasetId,
          metadata: { botId, count: created.length },
        },
        manager,
      );
      return created;
    });
  }

  async updateCase(
    workspaceId: WorkspaceId,
    botId: string,
    caseId: string,
    userId: UserId,
    input: UpdateEvalCaseRequest,
  ) {
    await this.requireBot(workspaceId, botId);
    return this.ds.transaction(async (manager) => {
      const row = await this.datasets.updateCase(workspaceId, caseId, input, manager);
      if (row === null) throw new AppError('not_found');
      const dataset = await this.datasets.getDataset(workspaceId, botId, row.dataset_id, manager);
      if (dataset === null) throw new AppError('not_found');
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.case_updated',
          targetType: 'eval_case',
          targetId: caseId,
          metadata: { botId, datasetId: row.dataset_id, changes: Object.keys(input) },
        },
        manager,
      );
      return caseDto(row);
    });
  }

  async deleteCase(workspaceId: WorkspaceId, botId: string, caseId: string, userId: UserId) {
    await this.requireBot(workspaceId, botId);
    await this.ds.transaction(async (manager) => {
      // Verify bot ownership before delete; case ids are not treated as authorization tokens.
      const rows = await manager.query<{ id: string }[]>(
        `SELECT c.id FROM eval_cases c JOIN eval_datasets d ON d.id = c.dataset_id
          WHERE c.workspace_id = $1 AND c.id = $2 AND d.bot_id = $3 FOR UPDATE`,
        [workspaceId, caseId, botId],
      );
      if (rows[0] === undefined) throw new AppError('not_found');
      if (!(await this.datasets.deleteCase(workspaceId, caseId, manager))) {
        throw new AppError('not_found');
      }
      await this.audit.record(
        {
          workspaceId,
          actorUserId: userId,
          action: 'eval.case_deleted',
          targetType: 'eval_case',
          targetId: caseId,
          metadata: { botId },
        },
        manager,
      );
    });
    return { deleted: true };
  }

  async exportDataset(workspaceId: WorkspaceId, botId: string, datasetId: string) {
    await this.requireDataset(workspaceId, botId, datasetId);
    const page = await this.datasets.listCases(workspaceId, datasetId, MAX_DATASET_CASES);
    return casesForExport(
      page.data.map((item) => ({
        question: item.question,
        history: item.history,
        ...(item.expectedAnswer === null ? {} : { expectedAnswer: item.expectedAnswer }),
        expectedDocumentIds: item.expectedDocumentIds,
        mustInclude: item.mustInclude,
        mustNotInclude: item.mustNotInclude,
        ...(item.expectHandoff === null ? {} : { expectHandoff: item.expectHandoff }),
        needsExpectation: item.needsExpectation,
        origin: item.origin,
        ...(item.originRef === null ? {} : { originRef: item.originRef }),
      })),
    );
  }

  async importDataset(
    workspaceId: WorkspaceId,
    botId: string,
    datasetId: string,
    userId: UserId,
    input: unknown,
  ) {
    await this.requireDataset(workspaceId, botId, datasetId);
    const parsed = parseEvalImport(input);
    const cases =
      parsed.kind === 'export'
        ? parsed.cases
        : importRagFixtures(
            parsed.fixtures,
            await this.datasets.documentsByTitle(workspaceId, botId),
          );
    const created = await this.createCases(workspaceId, botId, datasetId, userId, cases);
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'eval.dataset_imported',
      targetType: 'eval_dataset',
      targetId: datasetId,
      metadata: { botId, count: created.length, format: parsed.kind },
    });
    return { data: created, imported: created.length };
  }

  private async requireBot(workspaceId: WorkspaceId, botId: string) {
    if (!(await this.datasets.botExists(workspaceId, botId))) throw new AppError('not_found');
  }

  private async requireDataset(workspaceId: WorkspaceId, botId: string, datasetId: string) {
    await this.requireBot(workspaceId, botId);
    if (!(await this.datasets.datasetExists(workspaceId, botId, datasetId))) {
      throw new AppError('not_found');
    }
  }
}
