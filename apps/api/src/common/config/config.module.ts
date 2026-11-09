// SPDX-License-Identifier: AGPL-3.0-only
import { type DynamicModule, Module } from '@nestjs/common';

import type { AppConfig } from './config.schema';

/** Injection token for the validated `AppConfig`: `@Inject(APP_CONFIG) config: AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class ConfigModule {
  /** Registers `config` globally, so feature modules inject it without importing this one. */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
