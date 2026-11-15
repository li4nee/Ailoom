// SPDX-License-Identifier: AGPL-3.0-only
import { PinoLogger } from 'nestjs-pino';

import { type JobHandler, JobProcessor } from '../../jobs';
import { CONVERSATION_RETENTION_JOB } from './conversation-retention.job';
import { ConversationsRepository } from './conversations.repository';

interface Payload {
  olderThanDays: number;
}

/** Hard-deletes conversations older than the cutoff, idempotently. */
@JobProcessor(CONVERSATION_RETENTION_JOB)
export class ConversationRetentionProcessor implements JobHandler<Payload> {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationRetentionProcessor.name);
  }

  async handle(payload: Payload): Promise<void> {
    const cutoff = new Date(Date.now() - payload.olderThanDays * 86_400_000);
    const deleted = await this.conversations.deleteOlderThan(cutoff);
    this.logger.info({ olderThanDays: payload.olderThanDays, deleted }, 'conversations retained');
  }
}
