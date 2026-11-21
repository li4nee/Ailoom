// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import { SecretBox } from '../../common/crypto';
import type { IntegrationConnector } from './connectors/connector';
import { ConnectorRegistry } from './connectors/connector-registry';
import { ConnectorAuthError, ConnectorTransientError } from './connectors/rest-crm-connector';
import type { IntegrationEntity } from './integration.entity';
import { IntegrationsService } from './integrations.service';

const WORKSPACE_ID = '0190b000-0000-7000-8000-000000000013' as never;
const USER_ID = '0190b000-0000-7000-8000-000000000014' as never;
const INTEGRATION_ID = '0190b000-0000-7000-8000-000000000015';
const NOW = new Date('2026-01-01T00:00:00Z');

function row(overrides: Partial<IntegrationEntity> = {}): IntegrationEntity {
  return {
    id: INTEGRATION_ID,
    workspaceId: WORKSPACE_ID,
    provider: 'hubspot',
    name: 'Support CRM',
    status: 'active',
    scopes: ['contacts'],
    externalAccountId: 'portal-1',
    transcriptSharing: false,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    disconnectedAt: null,
    ...overrides,
  } as IntegrationEntity;
}

function makeService(existing = row(), registry = new ConnectorRegistry()) {
  const insertedCredential = vi.fn();
  const deliveries = {
    beginAttempt: vi.fn().mockResolvedValue(true),
    finishAttempt: vi.fn().mockResolvedValue(undefined),
    skip: vi.fn().mockResolvedValue(undefined),
    listForIntegration: vi.fn().mockResolvedValue([]),
  };
  const links = { upsert: vi.fn().mockResolvedValue({}) };
  const integrations = {
    listForWorkspace: vi.fn().mockResolvedValue([existing]),
    insertIntegration: vi.fn().mockResolvedValue(existing),
    insertCredential: insertedCredential.mockResolvedValue({}),
    getById: vi.fn().mockResolvedValue(existing),
    getCredential: vi.fn(),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    updateById: vi
      .fn()
      .mockImplementation((_workspace: unknown, _id: unknown, patch: Partial<IntegrationEntity>) =>
        Promise.resolve(
          row({
            status: patch.status ?? existing.status,
            lastError: patch.lastError ?? existing.lastError,
            disconnectedAt: patch.disconnectedAt ?? existing.disconnectedAt,
            updatedAt: NOW,
          }),
        ),
      ),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const dataSource = {
    transaction: vi.fn(async (callback: (manager: unknown) => Promise<unknown>) => callback({})),
  };
  const secrets = new SecretBox([{ version: 1, key: randomBytes(32) }]);
  const service = new IntegrationsService(
    dataSource as never,
    integrations as never,
    deliveries as never,
    links as never,
    secrets,
    audit,
    new FixedClock(NOW),
    registry,
  );
  return { service, integrations, audit, secrets, links, deliveries };
}

describe('IntegrationsService', () => {
  it('requires a tenant URL before connecting providers with tenant-specific hosts', async () => {
    const { service, integrations } = makeService();

    await expect(
      service.connect(WORKSPACE_ID, USER_ID, {
        provider: 'salesforce',
        name: 'Salesforce',
        scopes: [],
        authMode: 'bearer',
        accessToken: 'token',
        settings: { transcriptSharing: false },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(integrations.insertIntegration).not.toHaveBeenCalled();
  });

  it('requires the Zendesk account email when API-token authentication is selected', async () => {
    const { service, integrations } = makeService();

    await expect(
      service.connect(WORKSPACE_ID, USER_ID, {
        provider: 'zendesk',
        name: 'Zendesk',
        scopes: [],
        authMode: 'api_key',
        accessToken: 'token',
        baseUrl: 'https://acme.zendesk.com',
        settings: { transcriptSharing: false },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(integrations.insertIntegration).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS or non-origin tenant URLs before storing credentials', async () => {
    const { service, integrations } = makeService();

    await expect(
      service.connect(WORKSPACE_ID, USER_ID, {
        provider: 'freshdesk',
        name: 'Freshdesk',
        scopes: [],
        authMode: 'api_key',
        accessToken: 'token',
        baseUrl: 'http://acme.freshdesk.com/api/v2',
        settings: { transcriptSharing: false },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(integrations.insertIntegration).not.toHaveBeenCalled();
  });

  it('seals credentials and never includes them in the integration dto', async () => {
    const { service, integrations, secrets } = makeService();

    const created = await service.connect(WORKSPACE_ID, USER_ID, {
      provider: 'hubspot',
      name: 'Support CRM',
      scopes: ['contacts'],
      authMode: 'bearer',
      accessToken: 'oauth-secret',
      refreshToken: 'refresh-secret',
      externalAccountId: 'portal-1',
      settings: { transcriptSharing: false },
    });

    expect(created).not.toHaveProperty('accessToken');
    expect(created).not.toHaveProperty('refreshToken');
    const sealed = integrations.insertCredential.mock.calls[0]?.[2] as {
      ciphertext: Buffer;
      iv: Buffer;
      tag: Buffer;
      keyVersion: number;
    };
    expect(sealed.ciphertext.toString('utf8')).not.toContain('oauth-secret');
    expect(secrets.open(sealed)).toContain('oauth-secret');
  });

  it('disconnects idempotently and deletes encrypted credentials', async () => {
    const { service, integrations, audit } = makeService();
    integrations.getById
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'disconnected', disconnectedAt: NOW }));

    await service.disconnect(WORKSPACE_ID, USER_ID, INTEGRATION_ID);
    await service.disconnect(WORKSPACE_ID, USER_ID, INTEGRATION_ID);

    expect(integrations.deleteCredential).toHaveBeenCalledTimes(2);
    expect(integrations.updateById).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.disconnected' }),
      expect.anything(),
    );
  });

  it('rejects resuming a disconnected integration', async () => {
    const { service } = makeService(row({ status: 'disconnected' }));

    await expect(
      service.setStatus(WORKSPACE_ID, USER_ID, INTEGRATION_ID, 'active'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('dispatches contact events and persists the provider object mapping', async () => {
    const handle = vi.fn().mockResolvedValue({
      externalObjectId: 'crm-contact-1',
      externalObjectType: 'contact',
      idempotencyKey: 'event-1',
    });
    const connector: IntegrationConnector = {
      provider: 'hubspot',
      capabilities: ['contacts'],
      supportsEvent: () => true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      test: vi.fn(),
      handle,
    };
    const { service, integrations, secrets, links, deliveries } = makeService(
      row(),
      new ConnectorRegistry([connector]),
    );
    integrations.getCredential.mockResolvedValue(
      secrets.seal(JSON.stringify({ accessToken: 'oauth-secret' })),
    );

    await service.handleEvent({
      id: 'event-1',
      type: 'contact.updated',
      workspaceId: WORKSPACE_ID,
      aggregateId: '0190b000-0000-7000-8000-000000000016',
      occurredAt: NOW.toISOString(),
      version: 1,
      data: { contactId: '0190b000-0000-7000-8000-000000000016' },
    });

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-1' }),
      expect.objectContaining({ credentials: { accessToken: 'oauth-secret' } }),
    );
    expect(links.upsert).toHaveBeenCalledWith(WORKSPACE_ID, {
      integrationId: INTEGRATION_ID,
      contactId: '0190b000-0000-7000-8000-000000000016',
      objectType: 'contact',
      externalObjectId: 'crm-contact-1',
      idempotencyKey: 'event-1',
    });
    expect(deliveries.finishAttempt).toHaveBeenCalledWith(
      WORKSPACE_ID,
      INTEGRATION_ID,
      'event-1',
      expect.objectContaining({
        status: 'delivered',
        externalObjectId: 'crm-contact-1',
        externalObjectType: 'contact',
      }),
    );
  });

  it('marks an integration for reauthentication after a provider auth failure', async () => {
    const connector: IntegrationConnector = {
      provider: 'hubspot',
      capabilities: ['contacts'],
      supportsEvent: () => true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      test: vi.fn(),
      handle: vi.fn().mockRejectedValue(new ConnectorAuthError('expired token', 401)),
    };
    const { service, integrations, secrets, deliveries } = makeService(
      row(),
      new ConnectorRegistry([connector]),
    );
    integrations.getCredential.mockResolvedValue(
      secrets.seal(JSON.stringify({ accessToken: 'expired-secret' })),
    );

    await service.handleEvent({
      id: 'event-2',
      type: 'contact.updated',
      workspaceId: WORKSPACE_ID,
      aggregateId: '0190b000-0000-7000-8000-000000000016',
      occurredAt: NOW.toISOString(),
      version: 1,
      data: { contactId: '0190b000-0000-7000-8000-000000000016' },
    });

    expect(integrations.updateById).toHaveBeenCalledWith(WORKSPACE_ID, INTEGRATION_ID, {
      status: 'reauth_required',
      lastError: 'reauth_required',
    });
    expect(deliveries.finishAttempt).toHaveBeenCalledWith(
      WORKSPACE_ID,
      INTEGRATION_ID,
      'event-2',
      expect.objectContaining({
        status: 'failed',
        lastError: 'reauth_required',
        statusCode: 401,
      }),
    );
  });

  it('records retrying and terminal delivery states for transient CRM errors', async () => {
    const connector: IntegrationConnector = {
      provider: 'hubspot',
      capabilities: ['contacts'],
      supportsEvent: () => true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      test: vi.fn(),
      handle: vi.fn().mockRejectedValue(new ConnectorTransientError('rate limited', 429)),
    };
    const { service, integrations, secrets, deliveries } = makeService(
      row(),
      new ConnectorRegistry([connector]),
    );
    integrations.getCredential.mockResolvedValue(
      secrets.seal(JSON.stringify({ accessToken: 'test-token' })),
    );
    const event = {
      id: 'event-retry',
      type: 'contact.updated' as const,
      workspaceId: WORKSPACE_ID,
      aggregateId: '0190b000-0000-7000-8000-000000000016',
      occurredAt: NOW.toISOString(),
      version: 1 as const,
      data: { contactId: '0190b000-0000-7000-8000-000000000016' },
    };

    await expect(service.handleEvent(event, 1, 2)).rejects.toBeInstanceOf(ConnectorTransientError);
    expect(deliveries.finishAttempt).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      INTEGRATION_ID,
      'event-retry',
      expect.objectContaining({ status: 'retrying', lastError: 'provider_rate_limited' }),
    );

    await expect(service.handleEvent(event, 2, 2)).resolves.toBeUndefined();
    expect(deliveries.finishAttempt).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      INTEGRATION_ID,
      'event-retry',
      expect.objectContaining({ status: 'failed', lastError: 'provider_rate_limited' }),
    );
  });

  it('lists recent CRM delivery records only after checking workspace ownership', async () => {
    const { service, integrations, deliveries } = makeService();
    deliveries.listForIntegration.mockResolvedValue([
      {
        id: 'delivery-1',
        workspaceId: WORKSPACE_ID,
        integrationId: INTEGRATION_ID,
        eventId: 'event-1',
        eventType: 'contact.updated',
        status: 'delivered',
        attemptCount: 1,
        statusCode: 200,
        durationMs: 25,
        lastError: null,
        externalObjectType: 'contact',
        externalObjectId: 'crm-1',
        deliveredAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      } as never,
    ]);

    const result = await service.listDeliveries(WORKSPACE_ID, INTEGRATION_ID);

    expect(integrations.getById).toHaveBeenCalledWith(WORKSPACE_ID, INTEGRATION_ID, 'not_found');
    expect(deliveries.listForIntegration).toHaveBeenCalledWith(WORKSPACE_ID, INTEGRATION_ID);
    expect(result[0]).toMatchObject({
      eventId: 'event-1',
      status: 'delivered',
      statusCode: 200,
      externalObjectId: 'crm-1',
    });
  });
});
