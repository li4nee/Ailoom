// SPDX-License-Identifier: AGPL-3.0-only
import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from '../../common/clock';
import { INVITATION_ACCEPTANCE } from '../auth';
import { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';
import { MembershipsRepository } from './memberships.repository';

/**
 * Workspaces and their members. Global so auth can inject the `INVITATION_ACCEPTANCE` port
 * without importing this module (which imports auth's user entity). Task 1.10 adds the HTTP
 * surface and workspace service here.
 */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    InvitationsRepository,
    MembershipsRepository,
    InvitationsService,
    { provide: INVITATION_ACCEPTANCE, useExisting: InvitationsService },
  ],
  exports: [InvitationsService, INVITATION_ACCEPTANCE],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class WorkspacesModule {}
