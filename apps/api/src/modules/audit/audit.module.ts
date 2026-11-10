// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/** Every feature module records through `AuditService`; only admins read the log. */
@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class AuditModule {}
