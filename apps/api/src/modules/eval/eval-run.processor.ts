// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { asWorkspaceId } from '../../db/ids';
import { JobsService, JobProcessor, type JobHandler } from '../../jobs';
import { notifyWorkspace } from '../realtime';
import { EVAL_CASE_JOB, EVAL_RUN_JOB, type EvalRunPayload } from './eval.jobs';
import { RunsRepository } from './runs.repository';

@Injectable()
@JobProcessor(EVAL_RUN_JOB)
export class EvalRunProcessor implements JobHandler<EvalRunPayload> {
  constructor(
    private readonly ds: DataSource,
    private readonly runs: RunsRepository,
    private readonly jobs: JobsService,
  ) {}

  async handle(payload: EvalRunPayload): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const workspaceId = asWorkspaceId(payload.workspaceId);
      const run = await this.runs.startQueuedRun(workspaceId, payload.runId, manager);
      if (run === null) return;
      for (let caseIndex = 0; caseIndex < run.cases_snapshot.length; caseIndex += 1) {
        await this.jobs.enqueue(
          EVAL_CASE_JOB,
          { workspaceId: payload.workspaceId, runId: payload.runId, caseIndex },
          { manager, singletonKey: `${payload.runId}:${String(caseIndex)}` },
        );
      }
      await notifyWorkspace(manager, workspaceId, {
        type: 'eval.updated',
        runId: payload.runId,
      });
    });
  }
}
