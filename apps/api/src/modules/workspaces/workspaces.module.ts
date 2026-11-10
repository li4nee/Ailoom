// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { Clock, SystemClock } from '../../common/clock';
import { AuditModule } from '../audit';
import { INVITATION_ACCEPTANCE } from '../auth';
import { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';
import { MembershipsRepository } from './memberships.repository';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesRepository } from './workspaces.repository';
import { WorkspacesService } from './workspaces.service';

/**
 * Workspaces and their members. Global so auth can inject the `INVITATION_ACCEPTANCE` port
 * without importing this module (which imports auth's user entity). Audit entries go through
 * the `AUDIT_LOG` port provided by the global `AuditModule`.
 */
@Global()
@Module({
  // Global: later milestones' listeners subscribe to workspace events without importing this.
  imports: [AuditModule, EventEmitterModule.forRoot()],
  controllers: [WorkspacesController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    InvitationsRepository,
    MembershipsRepository,
    WorkspacesRepository,
    InvitationsService,
    { provide: INVITATION_ACCEPTANCE, useExisting: InvitationsService },
    WorkspacesService,
  ],
  exports: [
    InvitationsService,
    INVITATION_ACCEPTANCE,
    MembershipsRepository,
    WorkspacesRepository,
    WorkspacesService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class WorkspacesModule {}
