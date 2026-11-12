// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { asWorkspaceId } from '../../db/ids';
import { WORKSPACE_CREATED, type WorkspaceCreatedEvent } from '../workspaces';
import { CredentialsRepository } from './credentials.repository';

/** The label of the platform's own credential; the admin UI shows it as read-only. */
export const LOCAL_CREDENTIAL_LABEL = 'Built-in (local)';

/**
 * Creates the workspace's built-in `local` embedding credential (spec §9.4) as soon as the
 * workspace commits, so bots can default to local embeddings without an admin configuring
 * anything. When `LOCAL_EMBEDDINGS` is off nothing local is reachable, so no credential is
 * provisioned and the workspace simply has no built-in row.
 */
@Injectable()
export class LocalCredentialListener {
  constructor(
    private readonly ds: DataSource,
    private readonly repository: CredentialsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // Awaited (not `{ async: true }`, which defers to `setImmediate`): the workspace's next
  // request may already list credentials, so the row must exist before `workspace.created`
  // finishes. `WorkspacesService` catches and logs a failure, so creation still succeeds.
  @OnEvent(WORKSPACE_CREATED)
  async handle(event: WorkspaceCreatedEvent): Promise<void> {
    if (!this.config.localEmbeddings) return;
    const workspaceId = asWorkspaceId(event.workspaceId);

    await this.ds.transaction(async (manager) => {
      // The event is emitted once per workspace, but a retried or replayed delivery must not
      // leave two built-ins behind: `getLocal` resolves a single row.
      if ((await this.repository.findByProvider(workspaceId, 'local', manager)) !== null) return;
      await this.repository.insert(
        workspaceId,
        { provider: 'local', label: LOCAL_CREDENTIAL_LABEL },
        manager,
      );
    });
  }
}
