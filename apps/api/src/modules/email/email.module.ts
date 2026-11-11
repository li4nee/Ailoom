// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { assertNever } from '../../common/assert-never';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { EmailProcessor } from './email.processor';
import { EmailService } from './email.service';
import { LogMailer, type InfoLogSink } from './log.mailer';
import { MAILER, type Mailer } from './mailer';
import { ResendMailer } from './resend.mailer';
import { SmtpMailer } from './smtp.mailer';

export interface EmailModuleOptions {
  /** Bind a fixed mailer instead of the configured transport (the test harness). */
  mailer?: Mailer;
}

function mailerFor(config: AppConfig, sink: InfoLogSink): Mailer {
  switch (config.email.transport) {
    case 'smtp':
      return new SmtpMailer(config.email);
    case 'resend':
      return new ResendMailer(config.email);
    case 'none':
      return new LogMailer(sink);
    default:
      return assertNever(config.email);
  }
}

/**
 * Transactional email. Both apps import it: the api only enqueues `email.send` jobs through
 * `EmailService`; the worker processes them with the configured transport. Global so any
 * module can inject `EmailService` without importing this one.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class EmailModule {
  static forRoot(options: EmailModuleOptions = {}): DynamicModule {
    return {
      module: EmailModule,
      global: true,
      providers: [
        EmailService,
        EmailProcessor,
        options.mailer === undefined
          ? {
              provide: MAILER,
              inject: [APP_CONFIG, PinoLogger],
              useFactory: (config: AppConfig, sink: InfoLogSink): Mailer => mailerFor(config, sink),
            }
          : { provide: MAILER, useValue: options.mailer },
      ],
      exports: [EmailService],
    };
  }
}
