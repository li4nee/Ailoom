// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import type { CreateWorkspaceRequest, UpdateWorkspaceRequest } from '@app/shared';

import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asWorkspaceId, type UserId } from '../../db/ids';
import { workspaceSlug } from './domain/slug';
import { WORKSPACE_CREATED, type WorkspaceCreatedEvent } from './domain/workspace-events';
import type { WorkspaceEntity } from './entities/workspace.entity';
import { MembershipsRepository, type MembershipRow } from './memberships.repository';
import { WorkspacesRepository, type WorkspaceSummaryRow } from './workspaces.repository';

/** Workspace use cases. Role and verified-email checks run in the guard (see the controller). */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly ds: DataSource,
    private readonly workspaces: WorkspacesRepository,
    private readonly memberships: MembershipsRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    private readonly events: EventEmitter2,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkspacesService.name);
  }

  async create(ownerId: UserId, input: CreateWorkspaceRequest): Promise<WorkspaceEntity> {
    const slug = workspaceSlug(input.name);
    const workspace = await this.ds.transaction(async (manager) => {
      const created = await this.workspaces.insert({ name: input.name, slug }, manager);
      await this.memberships.insert(asWorkspaceId(created.id), ownerId, 'owner', manager);
      await this.audit.record(
        {
          workspaceId: asWorkspaceId(created.id),
          actorUserId: ownerId,
          action: 'workspace.created',
          targetType: 'workspace',
          targetId: created.id,
          metadata: { name: created.name, slug: created.slug },
        },
        manager,
      );
      return created;
    });

    // Consumers (Task 2.6 provisioning) must not see an uncommitted workspace or fail creation.
    await this.emitCreated({ workspaceId: workspace.id, ownerId });
    return workspace;
  }

  async list(userId: UserId): Promise<WorkspaceSummaryRow[]> {
    return this.workspaces.listForUser(userId);
  }

  async get(workspaceId: string): Promise<WorkspaceEntity> {
    const workspace = await this.workspaces.findById(workspaceId);
    if (workspace === null) throw new AppError('not_found');
    return workspace;
  }

  async update(
    workspaceId: string,
    actorId: UserId,
    input: UpdateWorkspaceRequest,
  ): Promise<WorkspaceEntity> {
    const patch: { name?: string; settings?: Record<string, unknown> } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.settings?.notificationEmails !== undefined) {
      // Only the changed keys: the repository merges them into the locked row's settings.
      patch.settings = { notificationEmails: input.settings.notificationEmails };
    }
    if (Object.keys(patch).length === 0) return this.get(workspaceId);

    return this.ds.transaction(async (manager) => {
      const updated = await this.workspaces.update(workspaceId, patch, manager);
      await this.audit.record(
        {
          workspaceId: asWorkspaceId(workspaceId),
          actorUserId: actorId,
          action: 'workspace.updated',
          targetType: 'workspace',
          targetId: workspaceId,
          metadata: { changed: Object.keys(patch) },
        },
        manager,
      );
      return updated;
    });
  }

  async members(workspaceId: string): Promise<MembershipRow[]> {
    await this.get(workspaceId);
    return this.memberships.listForWorkspace(asWorkspaceId(workspaceId));
  }

  private async emitCreated(event: WorkspaceCreatedEvent): Promise<void> {
    try {
      await this.events.emitAsync(WORKSPACE_CREATED, event);
    } catch (error) {
      this.logger.warn(
        { err: error, workspaceId: event.workspaceId },
        'workspace.created listener failed',
      );
    }
  }
}
