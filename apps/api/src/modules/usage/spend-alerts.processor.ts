// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { asWorkspaceId } from '../../db/ids';
import { type JobHandler, JobProcessor } from '../../jobs';
import { BotsRepository } from '../bots';
import { EmailService } from '../email';
import { SPEND_ALERTS_JOB } from './spend-alerts.job';
import { UsageRepository } from './usage.repository';

type Payload = z.infer<typeof SPEND_ALERTS_JOB.schema>;

/**
 * Composes and sends one spend alert (spec §15.2). The bot may have been deleted or its cap
 * removed between enqueue and processing, in which case there is nothing to report.
 */
@JobProcessor(SPEND_ALERTS_JOB)
export class SpendAlertsProcessor implements JobHandler<Payload> {
  constructor(
    private readonly bots: BotsRepository,
    private readonly usage: UsageRepository,
    private readonly email: EmailService,
  ) {}

  async handle(payload: Payload): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const bot = await this.bots.findById(workspaceId, payload.botId);
    if (bot === null) return;
    if (bot.deletedAt !== null || bot.monthlySpendCapUsd === null) return;

    const recipients = await this.usage.alertRecipients(workspaceId);
    if (recipients.length === 0) return;

    const mtdUsd = await this.usage.monthCost(workspaceId, payload.botId, payload.month);
    const topContacts = await this.usage.topContactsByCost(
      workspaceId,
      payload.botId,
      payload.month,
    );

    for (const to of recipients) {
      await this.email.send('spend_alert', to, {
        botName: bot.name,
        month: payload.month,
        threshold: payload.threshold,
        mtdUsd,
        capUsd: bot.monthlySpendCapUsd,
        topContacts,
      });
    }
  }
}
