// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { defineJob, JobsService } from '../../jobs';
import { EMAIL_TEMPLATE_NAMES, type EmailTemplateName, type TemplateData } from './templates';

/**
 * The only email job: one envelope with the template and its (untyped) data. The data is
 * validated against the template's schema when the worker renders it — per-template schemas
 * do not belong in the queue contract, which later milestones extend with new templates.
 */
export const EMAIL_SEND_JOB = defineJob({
  name: 'email.send',
  schema: z.object({
    template: z.enum(EMAIL_TEMPLATE_NAMES),
    to: z.string().max(254),
    data: z.record(z.string(), z.unknown()),
  }),
  retryLimit: 5,
  retryBackoff: true,
  concurrency: 4,
});

/**
 * Enqueues transactional email. Available in the api and the worker; the delivery itself
 * happens in the worker, where the job joins the caller's transaction when given one.
 */
@Injectable()
export class EmailService {
  constructor(
    private readonly jobs: JobsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** True when a real transport is configured; false means email is only logged. */
  isEnabled(): boolean {
    return this.config.email.transport !== 'none';
  }

  /** Queues `name` for delivery to `to`. With `manager`, the job commits or rolls back with it. */
  async send<N extends EmailTemplateName>(
    name: N,
    to: string,
    data: TemplateData[N],
    opts: { manager?: EntityManager } = {},
  ): Promise<void> {
    await this.jobs.enqueue(
      EMAIL_SEND_JOB,
      { template: name, to, data },
      opts.manager === undefined ? {} : { manager: opts.manager },
    );
  }
}
