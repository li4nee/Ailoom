// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { AuditModule } from '../audit';
import { CredentialsModule } from '../credentials';
import { BotsController } from './bots.controller';
import { BotsRepository } from './bots.repository';
import { BotsService } from './bots.service';

/**
 * Bots. Unlike credentials, the controller needs nothing from the model layer, so it is
 * registered here rather than by the HTTP app.
 */
@Module({
  imports: [AuditModule, CredentialsModule],
  controllers: [BotsController],
  providers: [BotsRepository, BotsService, { provide: Clock, useClass: SystemClock }],
  exports: [BotsRepository, BotsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class BotsModule {}
