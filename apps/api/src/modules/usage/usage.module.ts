// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { ModelPricesController } from './model-prices.controller';
import { ModelPricesRepository } from './model-prices.repository';
import { PricingService } from './pricing.service';
import { UsageRepository } from './usage.repository';

/**
 * Model prices and cost calculation (spec §9.5). `PricingService` is exported for the trace and
 * usage writes of later milestones; nothing here talks to a provider.
 */
@Module({
  controllers: [ModelPricesController],
  providers: [ModelPricesRepository, PricingService, UsageRepository],
  exports: [ModelPricesRepository, PricingService, UsageRepository],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class UsageModule {}
