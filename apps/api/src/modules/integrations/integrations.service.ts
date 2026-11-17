// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ConnectIntegrationRequest, IntegrationDto, IntegrationStatus } from '@app/shared';
import { connectIntegrationRequestSchema } from '@app/shared';

import { Clock } from '../../common/clock';
import { SecretBox } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import { asWorkspaceId, type UserId, type WorkspaceId } from '../../db/ids';
import type {
  ConnectionHealth,
  ConnectorHandleResult,
  IntegrationConnection,
} from './connectors/connector';
import { ConnectorRegistry } from './connectors/connector-registry';
import { ConnectorAuthError } from './connectors/rest-crm-connector';
import { IntegrationLinksRepository } from './integration-links.repository';
import { toIntegrationDto } from './integrations.mapper';
import { IntegrationsRepository } from './integrations.repository';

const STATUS_TRANSITIONS: Record<IntegrationStatus, readonly IntegrationStatus[]> = {
  active: ['paused', 'reauth_required', 'error', 'disconnected'],
  paused: ['active', 'disconnected'],
  reauth_required: ['active', 'disconnected'],
  error: ['active', 'paused', 'disconnected'],
  disconnected: [],
};

interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  baseUrl?: string;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly ds: DataSource,
    private readonly integrations: IntegrationsRepository,
    private readonly links: IntegrationLinksRepository,
    private readonly secrets: SecretBox,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    private readonly clock: Clock,
    private readonly registry: ConnectorRegistry,
  ) {}

  async list(workspaceId: WorkspaceId): Promise<IntegrationDto[]> {
    return (await this.integrations.listForWorkspace(workspaceId)).map(toIntegrationDto);
  }

  async connect(
    workspaceId: WorkspaceId,
    actorUserId: UserId,
    input: ConnectIntegrationRequest,
  ): Promise<IntegrationDto> {
    const parsed = connectIntegrationRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('validation_failed', {
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    const data = parsed.data;
    const credentials: StoredCredentials = {
      accessToken: data.accessToken,
      ...(data.refreshToken === undefined ? {} : { refreshToken: data.refreshToken }),
      ...(data.tokenExpiresAt === undefined ? {} : { tokenExpiresAt: data.tokenExpiresAt }),
      ...(data.baseUrl === undefined ? {} : { baseUrl: data.baseUrl }),
    };
    const sealed = this.secrets.seal(JSON.stringify(credentials));
    const created = await this.ds.transaction(async (manager) => {
      const integration = await this.integrations.insertIntegration(
        workspaceId,
        {
          provider: data.provider,
          name: data.name,
          status: 'active',
          scopes: [...data.scopes],
          externalAccountId: data.externalAccountId ?? null,
          transcriptSharing: data.settings.transcriptSharing,
          lastError: null,
          disconnectedAt: null,
        },
        manager,
      );
      await this.integrations.insertCredential(workspaceId, integration.id, sealed, manager);
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'integration.created',
          targetType: 'integration',
          targetId: integration.id,
          metadata: {
            provider: integration.provider,
            name: integration.name,
            scopes: integration.scopes,
            transcriptSharing: integration.transcriptSharing,
          },
        },
        manager,
      );
      return integration;
    });
    return toIntegrationDto(created);
  }

  async disconnect(workspaceId: WorkspaceId, actorUserId: UserId, id: string): Promise<void> {
    await this.ds.transaction(async (manager) => {
      const existing = await this.integrations.getById(workspaceId, id, 'not_found', manager);
      if (existing.status !== 'disconnected') {
        this.assertTransition(existing.status, 'disconnected');
        await this.integrations.updateById(
          workspaceId,
          id,
          { status: 'disconnected', disconnectedAt: this.clock.now(), lastError: null },
          manager,
        );
        await this.audit.record(
          {
            workspaceId,
            actorUserId,
            action: 'integration.disconnected',
            targetType: 'integration',
            targetId: id,
            metadata: { provider: existing.provider },
          },
          manager,
        );
      }
      await this.integrations.deleteCredential(workspaceId, id, manager);
    });
  }

  async setStatus(
    workspaceId: WorkspaceId,
    actorUserId: UserId,
    id: string,
    status: Exclude<IntegrationStatus, 'disconnected'>,
  ): Promise<IntegrationDto> {
    return this.ds.transaction(async (manager) => {
      const existing = await this.integrations.getById(workspaceId, id, 'not_found', manager);
      this.assertTransition(existing.status, status);
      const updated = await this.integrations.updateById(
        workspaceId,
        id,
        { status, lastError: status === 'active' ? null : existing.lastError },
        manager,
      );
      await this.audit.record(
        {
          workspaceId,
          actorUserId,
          action: 'integration.updated',
          targetType: 'integration',
          targetId: id,
          metadata: { changed: ['status'], status },
        },
        manager,
      );
      return toIntegrationDto(updated);
    });
  }

  async test(workspaceId: WorkspaceId, actorUserId: UserId, id: string): Promise<ConnectionHealth> {
    const connection = await this.getConnection(workspaceId, id);
    const connector = this.registry.get(connection.provider);
    if (connector === null) {
      throw new AppError('conflict', {
        message: `No connector is registered for ${connection.provider}.`,
      });
    }
    const health = await connector.test(connection);
    await this.audit.record({
      workspaceId,
      actorUserId,
      action: 'integration.tested',
      targetType: 'integration',
      targetId: id,
      metadata: { provider: connection.provider, ok: health.ok },
    });
    if (!health.ok) {
      await this.integrations.updateById(workspaceId, id, {
        status: 'error',
        lastError: health.detail?.slice(0, 500) ?? 'connection_failed',
      });
    }
    return health;
  }

  async handleEvent(event: import('./connectors/connector').IntegrationEvent): Promise<void> {
    const workspaceId = asWorkspaceId(event.workspaceId);
    const connections = await this.integrations.listForWorkspace(workspaceId);
    for (const integration of connections) {
      if (integration.status !== 'active') continue;
      const connector = this.registry.get(integration.provider);
      if (connector === null) continue;
      const connection = await this.getConnection(workspaceId, integration.id);
      let result: ConnectorHandleResult;
      try {
        result = await connector.handle(event, connection);
      } catch (error) {
        if (error instanceof ConnectorAuthError) {
          await this.integrations.updateById(workspaceId, integration.id, {
            status: 'reauth_required',
            lastError: 'reauth_required',
          });
          continue;
        }
        throw error;
      }
      if (result.externalObjectId === undefined) continue;
      const contactId =
        typeof event.data === 'object' && event.data !== null && 'contactId' in event.data
          ? event.data.contactId
          : undefined;
      if (typeof contactId !== 'string') continue;
      await this.links.upsert(workspaceId, {
        integrationId: integration.id,
        contactId,
        objectType: result.externalObjectType ?? 'contact',
        externalObjectId: result.externalObjectId,
        idempotencyKey: result.idempotencyKey ?? event.id,
      });
    }
  }

  private async getConnection(
    workspaceId: WorkspaceId,
    id: string,
  ): Promise<IntegrationConnection> {
    const integration = await this.integrations.getById(workspaceId, id);
    if (integration.status === 'disconnected') throw new AppError('conflict');
    const credential = await this.integrations.getCredential(workspaceId, id);
    if (credential === null) throw new AppError('conflict');
    const parsed = JSON.parse(
      this.secrets.open({
        ciphertext: credential.ciphertext,
        iv: credential.iv,
        tag: credential.tag,
        keyVersion: credential.keyVersion,
      }),
    ) as StoredCredentials;
    return {
      id: integration.id,
      workspaceId: asWorkspaceId(workspaceId),
      provider: integration.provider,
      scopes: integration.scopes,
      externalAccountId: integration.externalAccountId,
      settings: { transcriptSharing: integration.transcriptSharing },
      credentials: parsed,
    };
  }

  private assertTransition(from: IntegrationStatus, to: IntegrationStatus): void {
    if (!STATUS_TRANSITIONS[from].includes(to)) {
      throw new AppError('conflict', {
        message: `Cannot move an integration from ${from} to ${to}.`,
      });
    }
  }
}
