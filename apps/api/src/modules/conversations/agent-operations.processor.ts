// SPDX-License-Identifier: AGPL-3.0-only
import { type JobHandler, JobProcessor } from '../../jobs';
import { REVIEW_SLA_BREACHES_JOB } from './agent-operations.job';
import { AgentOperationsService } from './agent-operations.service';

@JobProcessor(REVIEW_SLA_BREACHES_JOB)
export class AgentOperationsProcessor implements JobHandler<Record<string, never>> {
  constructor(private readonly operations: AgentOperationsService) {}

  async handle(): Promise<void> {
    await this.operations.processSlaBreaches();
  }
}
