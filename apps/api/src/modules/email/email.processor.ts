// SPDX-License-Identifier: AGPL-3.0-only
import { Inject } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { type JobContext, type JobHandler, JobProcessor } from '../../jobs';
import { EMAIL_SEND_JOB } from './email.service';
import { MAILER, type Mailer } from './mailer';
import { renderTemplate, type EmailTemplateName, type TemplateContext } from './templates';

/**
 * Renders one queued `email.send` envelope with the template's schema as the source of truth
 * and hands it to the configured transport. A failed send throws, so pg-boss retries (5
 * attempts, exponential backoff) and records the error on the job.
 */
@JobProcessor(EMAIL_SEND_JOB)
export class EmailProcessor implements JobHandler<z.infer<typeof EMAIL_SEND_JOB.schema>> {
  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailProcessor.name);
  }

  async handle(
    payload: { template: EmailTemplateName; to: string; data: Record<string, unknown> },
    ctx: JobContext,
  ): Promise<void> {
    const context: TemplateContext = {
      publicUrl: this.config.publicUrl,
      productName: this.config.productName,
    };
    const rendered = renderTemplate(payload.template, payload.data, context);
    try {
      await this.mailer.send({ to: payload.to, ...rendered });
    } catch (error) {
      this.logger.error(
        { err: error, to: payload.to, attempt: ctx.attempt },
        'email delivery failed',
      );
      throw error;
    }
    this.logger.info({ to: payload.to, template: payload.template }, 'email sent');
  }
}
