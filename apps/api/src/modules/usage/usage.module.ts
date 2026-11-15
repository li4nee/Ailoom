// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { ModelPricesController } from './model-prices.controller';
import { ModelPricesRepository } from './model-prices.repository';
import { PricingService } from './pricing.service';
import { SpendCapService } from './spend-cap.service';
import { UsageController } from './usage.controller';
import { UsageRepository } from './usage.repository';
import { UsageService } from './usage.service';

/**
 * Model prices and cost calculation (spec §9.5). `PricingService` is exported for the trace and
 * usage writes of later milestones; nothing here talks to a provider.
 */
@Module({
  controllers: [ModelPricesController, UsageController],
  providers: [
    ModelPricesRepository,
    PricingService,
    SpendCapService,
    UsageRepository,
    UsageService,
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [ModelPricesRepository, PricingService, SpendCapService, UsageRepository, UsageService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class UsageModule {}
