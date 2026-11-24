// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationPayload } from '@app/shared';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { addMember, createUser, createWorkspace } from '../../../test/helpers/factories';
import { FixedClock } from '../../common/clock';
import { MembershipsRepository } from '../workspaces/memberships.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationEntity } from './notification.entity';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const payload: NotificationPayload = {
  title: 'A conversation needs a person',
  body: 'Help has a conversation waiting for an agent.',
};

describe('notifications inbox and preferences', () => {
  let ds: Awaited<ReturnType<typeof getTestDataSource>>;
  let workspaceId: string;
  let ownerId: string;
  let agentId: string;
  let memberships: MembershipsRepository;
  let repository: NotificationsRepository;
  let service: NotificationsService;
  let preferences: NotificationPreferencesService;
  let now: Date;
  const audit = { record: vi.fn(() => Promise.resolve()) };

  beforeAll(async () => {
    ds = await getTestDataSource();
  });

  beforeEach(async () => {
    await resetDatabase(ds);
    now = new Date('2026-11-24T12:00:00.000Z');
    const { user: owner } = await createUser({ ds }, { email: 'owner@example.com' });
    const { user: agent } = await createUser({ ds }, { email: 'agent@example.com' });
    const workspace = await createWorkspace({ ds }, owner);
    await addMember({ ds }, workspace, agent, 'agent');
    workspaceId = workspace.id;
    ownerId = owner.id;
    agentId = agent.id;
    memberships = new MembershipsRepository(ds);
    repository = new NotificationsRepository(ds);
    preferences = new NotificationPreferencesService(ds, memberships, audit);
    service = new NotificationsService(repository, memberships, preferences, new FixedClock(now), {
      isEnabled: () => false,
    } as never);
  });

  async function addNotification(userId: string, createdAt: Date, readAt: Date | null = null) {
    await ds.transaction(async (manager) => {
      const row = await repository.create(
        workspaceId as never,
        userId as never,
        'handoff_requested',
        payload,
        manager,
        null,
        createdAt,
      );
      if (readAt !== null) {
        await manager.getRepository(NotificationEntity).update({ id: row.id }, { readAt });
      }
    });
  }

  it('lists only the caller’s notifications, newest first, with an unread count', async () => {
    await addNotification(ownerId, new Date(now.getTime() - 1000));
    await addNotification(ownerId, now);
    await addNotification(agentId, now);

    const page = await service.list(workspaceId as never, ownerId as never, {
      limit: 1,
      unread: undefined,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.createdAt).toBe(now.toISOString());
    expect(page.unreadCount).toBe(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('marks one and all notifications read for the caller', async () => {
    await addNotification(ownerId, now);
    await addNotification(ownerId, new Date(now.getTime() - 1000));
    const initial = await service.list(workspaceId as never, ownerId as never, {
      limit: 10,
      unread: undefined,
    });

    const first = await service.markRead(
      workspaceId as never,
      ownerId as never,
      initial.data[0]!.id,
    );
    expect(first.readAt).toBe(now.toISOString());
    expect(await service.markAllRead(workspaceId as never, ownerId as never)).toEqual({
      updated: 1,
    });
    expect(
      (await service.list(workspaceId as never, ownerId as never, { limit: 10, unread: undefined }))
        .unreadCount,
    ).toBe(0);
  });

  it('returns 404 when a caller tries to mark another member’s notification read', async () => {
    await addNotification(agentId, now);
    const theirs = await service.list(workspaceId as never, agentId as never, {
      limit: 10,
      unread: undefined,
    });
    await expect(
      service.markRead(workspaceId as never, ownerId as never, theirs.data[0]!.id),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('returns role defaults and persists a validated per-type preference update', async () => {
    const defaults = await preferences.get(workspaceId as never, agentId as never);
    expect(defaults.visitor_replied).toEqual({ email: false, inApp: true });
    expect(defaults.handoff_requested).toEqual({ email: false, inApp: true });

    const updated = await preferences.update(workspaceId as never, agentId as never, {
      visitor_replied: { email: true, inApp: false },
    });
    expect(updated.visitor_replied).toEqual({ email: true, inApp: false });
    expect(
      (await memberships.notificationPreferences(workspaceId as never, agentId))
        ?.notificationPreferences,
    ).toEqual({ visitor_replied: { email: true, inApp: false } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notification.preferences_updated' }),
      expect.anything(),
    );
  });

  it('deletes a removed member’s notifications through the membership foreign key', async () => {
    await addNotification(agentId, now);
    await ds.query('DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2', [
      workspaceId,
      agentId,
    ]);
    expect(
      await ds
        .getRepository(NotificationEntity)
        .count({ where: { workspaceId: workspaceId as never } }),
    ).toBe(0);
  });

  it('retains unread rows for 180 days and read rows for 90 days', async () => {
    await addNotification(ownerId, new Date(now.getTime() - 181 * 86_400_000));
    await addNotification(
      ownerId,
      new Date(now.getTime() - 91 * 86_400_000),
      new Date(now.getTime() - 91 * 86_400_000),
    );
    await addNotification(ownerId, new Date(now.getTime() - 100 * 86_400_000), now);

    expect(await service.retain()).toBe(2);
    expect(await ds.getRepository(NotificationEntity).count()).toBe(1);
  });
});
