// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { RequestContextModule } from '../../common/context/request-context';
import { AUDIT_LOG } from '../../common/ports/audit';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * Global so every feature module can record an entry through the `AUDIT_LOG` port without
 * importing this module (its entity imports the workspaces/auth barrels).
 */
@Global()
@Module({
  imports: [RequestContextModule],
  controllers: [AuditController],
  providers: [AuditRepository, AuditService, { provide: AUDIT_LOG, useExisting: AuditService }],
  exports: [AuditService, AUDIT_LOG],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class AuditModule {}
