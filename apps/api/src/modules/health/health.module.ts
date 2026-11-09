// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class HealthModule {}
