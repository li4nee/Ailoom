// SPDX-License-Identifier: AGPL-3.0-only
import { PinoLogger } from 'nestjs-pino';

import { type JobHandler, JobProcessor } from '../../jobs';
import { TRACE_RETENTION_JOB } from './trace-retention.job';
import { TracesRepository } from './traces.repository';

interface Payload {
  olderThanDays: number;
}

/** Hard-deletes traces older than the cutoff, idempotently. */
@JobProcessor(TRACE_RETENTION_JOB)
export class TraceRetentionProcessor implements JobHandler<Payload> {
  constructor(
    private readonly traces: TracesRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TraceRetentionProcessor.name);
  }

  async handle(payload: Payload): Promise<void> {
    const cutoff = new Date(Date.now() - payload.olderThanDays * 86_400_000);
    const deleted = await this.traces.deleteOlderThan(cutoff);
    this.logger.info({ olderThanDays: payload.olderThanDays, deleted }, 'traces retained');
  }
}
