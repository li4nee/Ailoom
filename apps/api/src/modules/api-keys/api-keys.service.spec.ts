// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import type { ApiKeyEntity } from './api-key.entity';
import { ApiKeysService } from './api-keys.service';

const WORKSPACE_ID = '0190b000-0000-7000-8000-000000000003' as never;
const USER_ID = '0190b000-0000-7000-8000-000000000004' as never;
const NOW = new Date('2026-01-01T00:00:00Z');

function row(overrides: Partial<ApiKeyEntity> = {}): ApiKeyEntity {
  return {
    id: '0190b000-0000-7000-8000-000000000005',
    workspaceId: WORKSPACE_ID,
    name: 'Deployments',
    keyHash: 'stored-hash',
    keyPrefix: 'ak_live_1234567',
    scopes: ['conversations:read'],
    createdByUserId: USER_ID,
    createdAt: NOW,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  } as ApiKeyEntity;
}

function makeService(existing = row()) {
  const insertKey = vi.fn().mockResolvedValue(existing);
  const getById = vi.fn().mockResolvedValue(existing);
  const updateById = vi.fn().mockResolvedValue(existing);
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const dataSource = {
    transaction: vi.fn(async (callback: (manager: unknown) => Promise<ApiKeyEntity>) =>
      callback({}),
    ),
  };
  const keys = { insertKey, getById, updateById };
  return {
    service: new ApiKeysService(dataSource as never, keys as never, audit, new FixedClock(NOW)),
    insertKey,
    getById,
    updateById,
    audit,
  };
}

describe('ApiKeysService', () => {
  it('returns the raw token once but persists only its hash', async () => {
    const { service, insertKey, audit } = makeService();

    const created = await service.create(WORKSPACE_ID, USER_ID, {
      name: 'Deployments',
      scopes: ['conversations:read'],
    });

    expect(created.token).toMatch(/^ak_live_[A-Za-z0-9_-]+$/);
    expect(insertKey).toHaveBeenCalledTimes(1);
    const data = insertKey.mock.calls[0]?.[1] as { keyHash: string; name: string };
    expect(data.name).toBe('Deployments');
    expect(data.keyHash).not.toBe(created.token);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'api_key.created', targetType: 'api_key' }),
      expect.anything(),
    );
  });

  it('validates expiry and rejects dates in the past', async () => {
    const { service, insertKey } = makeService();

    await expect(
      service.create(WORKSPACE_ID, USER_ID, {
        name: 'Expired',
        scopes: ['conversations:read'],
        expiresAt: '2025-12-31T23:59:59.000Z',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(insertKey).not.toHaveBeenCalled();
  });

  it('revokes an active key idempotently', async () => {
    const { service, updateById, audit } = makeService();

    await service.revoke(WORKSPACE_ID, USER_ID, row().id);

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'api_key.revoked' }),
      expect.anything(),
    );

    const revoked = makeService(row({ revokedAt: NOW }));
    await revoked.service.revoke(WORKSPACE_ID, USER_ID, row().id);
    expect(revoked.updateById).not.toHaveBeenCalled();
  });

  it('rotates by revoking the old key and preserving its scopes', async () => {
    const { service, insertKey, updateById, audit } = makeService();

    const rotated = await service.rotate(WORKSPACE_ID, USER_ID, row().id);

    expect(rotated.token).toMatch(/^ak_live_/);
    expect(updateById).toHaveBeenCalledWith(
      WORKSPACE_ID,
      row().id,
      expect.objectContaining({ revokedAt: NOW }),
      expect.anything(),
    );
    expect((insertKey.mock.calls[0]?.[1] as { scopes: string[] }).scopes).toEqual([
      'conversations:read',
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'api_key.rotated' }),
      expect.anything(),
    );
  });
});
