// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../common/clock';
import { asBotId, asContactId, asWorkspaceId } from '../../db/ids';
import type { BotEntity } from '../bots';
import type { ContactEntity } from '../conversations';
import type { ContactsRepository } from '../conversations';
import type { CurrentVisitorData } from './widget-rate-limits';
import { WidgetService } from './widget.service';

const CONTACT_ID = asContactId('0190b000-0000-7000-8000-000000000001');
const BOT_ID = asBotId('0190b000-0000-7000-8000-000000000002');
const WORKSPACE_ID = asWorkspaceId('0190b000-0000-7000-8000-000000000003');
const NOW = new Date('2026-01-01T00:00:00Z');

function contact(overrides: Partial<ContactEntity> = {}): ContactEntity {
  return {
    id: CONTACT_ID,
    workspaceId: WORKSPACE_ID,
    externalId: null,
    email: null,
    name: null,
    attributes: null,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastEmailedAt: null,
    ...overrides,
  } as ContactEntity;
}

function visitor(): CurrentVisitorData {
  return {
    claims: { contactId: CONTACT_ID, botId: BOT_ID, workspaceId: WORKSPACE_ID },
    bot: {} as BotEntity,
  };
}

function service(row: ContactEntity, claimed: ContactEntity | null = null) {
  const getById = vi.fn().mockResolvedValue(row);
  const findByExternalId = vi.fn().mockResolvedValue(claimed);
  const updateById = vi.fn((_workspaceId: unknown, _id: unknown, patch: Record<string, unknown>) =>
    Promise.resolve(Object.assign({}, row, patch) as ContactEntity),
  );
  const contacts = {
    getById,
    findByExternalId,
    updateById,
  } as unknown as ContactsRepository;
  const events = { emit: vi.fn() };
  const dataSource = {
    transaction: vi.fn(async (callback: (manager: unknown) => Promise<ContactEntity>) =>
      callback({}),
    ),
  };
  const instance = new WidgetService(
    new FixedClock(NOW),
    {} as never,
    {} as never,
    contacts,
    {} as never,
    {} as never,
    {} as never,
    events as never,
    dataSource as never,
  );
  return { instance, contacts, events, findByExternalId, updateById };
}

describe('WidgetService.identify', () => {
  it('merges identity attributes without replacing existing contact fields', async () => {
    const { instance, events, updateById } = service(
      contact({ email: 'existing@example.com', name: 'Existing', attributes: { plan: 'free' } }),
    );

    await expect(
      instance.identify(visitor(), {
        externalId: 'customer-42',
        attributes: { plan: 'pro', region: 'eu' },
      }),
    ).resolves.toMatchObject({
      contactId: CONTACT_ID,
      externalId: 'customer-42',
      email: 'existing@example.com',
      name: 'Existing',
      attributes: { plan: 'pro', region: 'eu' },
    });
    expect(updateById).toHaveBeenCalledWith(
      WORKSPACE_ID,
      CONTACT_ID,
      expect.objectContaining({
        externalId: 'customer-42',
        attributes: { plan: 'pro', region: 'eu' },
      }),
      expect.anything(),
    );
    expect(events.emit).toHaveBeenCalledWith('contact.updated', {
      workspaceId: WORKSPACE_ID,
      contactId: CONTACT_ID,
    });
  });

  it('rejects an external id claimed by another contact', async () => {
    const other = contact({ id: asContactId('0190b000-0000-7000-8000-000000000004') });
    const { instance, events, updateById } = service(contact(), other);

    await expect(instance.identify(visitor(), { externalId: 'customer-42' })).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    );
    expect(updateById).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('does not allow an identified visitor to change external identity', async () => {
    const { instance, events, findByExternalId, updateById } = service(
      contact({ externalId: 'customer-41' }),
    );

    await expect(instance.identify(visitor(), { externalId: 'customer-42' })).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    );
    expect(findByExternalId).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('rejects invalid input and oversized merged attributes before writing', async () => {
    const { instance, events, updateById } = service(contact());

    await expect(instance.identify(visitor(), { externalId: '' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(
      instance.identify(visitor(), {
        externalId: 'customer-42',
        attributes: { note: 'x'.repeat(16_385) },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(updateById).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
