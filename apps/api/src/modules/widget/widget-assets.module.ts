// SPDX-License-Identifier: AGPL-3.0-only
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';

import { WIDGET_ASSETS_DIR, WidgetAssetsController } from './widget-assets.controller';

/**
 * Serves the built widget bundles. Registered separately from `WidgetModule` because the
 * directory is an app-level input (from `createHttpApp`), not a database-backed feature.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest dynamic module
export class WidgetAssetsModule {
  static register(directory: string): DynamicModule {
    return {
      module: WidgetAssetsModule,
      controllers: [WidgetAssetsController],
      providers: [{ provide: WIDGET_ASSETS_DIR, useValue: directory }],
    };
  }
}
