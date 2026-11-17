// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import { SecretBox } from '../../common/crypto';
import type { IntegrationConnector } from './connectors/connector';
import { ConnectorRegistry } from './connectors/connector-registry';
import { ConnectorAuthError } from './connectors/rest-crm-connector';
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
    links as never,
    secrets,
    audit,
    new FixedClock(NOW),
    registry,
  );
  return { service, integrations, audit, secrets, links };
}

describe('IntegrationsService', () => {
  it('seals credentials and never includes them in the integration dto', async () => {
    const { service, integrations, secrets } = makeService();

    const created = await service.connect(WORKSPACE_ID, USER_ID, {
      provider: 'hubspot',
      name: 'Support CRM',
      scopes: ['contacts'],
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
      connect: vi.fn(),
      disconnect: vi.fn(),
      test: vi.fn(),
      handle,
    };
    const { service, integrations, secrets, links } = makeService(
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
  });

  it('marks an integration for reauthentication after a provider auth failure', async () => {
    const connector: IntegrationConnector = {
      provider: 'hubspot',
      capabilities: ['contacts'],
      connect: vi.fn(),
      disconnect: vi.fn(),
      test: vi.fn(),
      handle: vi.fn().mockRejectedValue(new ConnectorAuthError('expired token')),
    };
    const { service, integrations, secrets } = makeService(
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
  });
});
