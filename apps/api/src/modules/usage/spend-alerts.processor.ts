// SPDX-License-Identifier: AGPL-3.0-only
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { asWorkspaceId } from '../../db/ids';
import { type JobHandler, JobProcessor } from '../../jobs';
import { BotsRepository } from '../bots';
import { NotificationsService } from '../notifications';
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
    private readonly ds: DataSource,
    private readonly bots: BotsRepository,
    private readonly usage: UsageRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(payload: Payload): Promise<void> {
    const workspaceId = asWorkspaceId(payload.workspaceId);
    const bot = await this.bots.findById(workspaceId, payload.botId);
    if (bot === null) return;
    const capUsd = bot.monthlySpendCapUsd;
    if (bot.deletedAt !== null || capUsd === null) return;

    const recipients = await this.usage.alertRecipients(workspaceId);
    if (recipients.length === 0) return;

    const mtdUsd = await this.usage.monthCost(workspaceId, payload.botId, payload.month);
    const topContacts = await this.usage.topContactsByCost(
      workspaceId,
      payload.botId,
      payload.month,
    );

    await this.ds.transaction((manager) =>
      this.notifications.notify(manager, {
        type: 'spend_alert',
        workspaceId,
        botId: bot.id,
        botName: bot.name,
        actorUserId: null,
        month: payload.month,
        threshold: payload.threshold,
        mtdUsd,
        capUsd,
        topContacts,
        legacyRecipients: recipients,
      }),
    );
  }
}
