// SPDX-License-Identifier: AGPL-3.0-only
import { PinoLogger } from 'nestjs-pino';

import { type JobHandler, JobProcessor } from '../../jobs';
import { SESSION_RETENTION_JOB } from './session-retention.job';
import { SessionsRepository } from './sessions.repository';

interface Payload {
  olderThanDays: number;
}

/** Deletes revoked sessions older than the cutoff, idempotently. */
@JobProcessor(SESSION_RETENTION_JOB)
export class SessionRetentionProcessor implements JobHandler<Payload> {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SessionRetentionProcessor.name);
  }

  async handle(payload: Payload): Promise<void> {
    const cutoff = new Date(Date.now() - payload.olderThanDays * 86_400_000);
    const deleted = await this.sessions.deleteRevokedBefore(cutoff);
    this.logger.info({ olderThanDays: payload.olderThanDays, deleted }, 'sessions retained');
  }
}
