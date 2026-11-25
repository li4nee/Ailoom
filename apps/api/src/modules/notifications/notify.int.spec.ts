// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { addMember, createUser, createWorkspace } from '../../../test/helpers/factories';
import { FixedClock } from '../../common/clock';
import { MembershipsRepository } from '../workspaces/memberships.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationEntity } from './notification.entity';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

describe('notification events', () => {
  let ds: Awaited<ReturnType<typeof getTestDataSource>>;
  let workspaceId: string;
  let ownerId: string;
  let adminId: string;
  let agentId: string;
  let notifications: NotificationsService;
  let sent: { template: string; to: string; data: unknown }[];
  const now = new Date('2026-11-24T12:00:00.000Z');

  beforeAll(async () => {
    ds = await getTestDataSource();
  });

  beforeEach(async () => {
    await resetDatabase(ds);
    const { user: owner } = await createUser({ ds }, { email: 'owner@example.com' });
    const { user: admin } = await createUser({ ds }, { email: 'admin@example.com' });
    const { user: agent } = await createUser({ ds }, { email: 'agent@example.com' });
    const workspace = await createWorkspace({ ds }, owner);
    await addMember({ ds }, workspace, admin, 'admin');
    await addMember({ ds }, workspace, agent, 'agent');
    workspaceId = workspace.id;
    ownerId = owner.id;
    adminId = admin.id;
    agentId = agent.id;
    sent = [];
    const email = {
      isEnabled: () => true,
      send: (template: string, to: string, data: unknown) => {
        sent.push({ template, to, data });
        return Promise.resolve();
      },
    };
    const memberships = new MembershipsRepository(ds);
    notifications = new NotificationsService(
      new NotificationsRepository(ds),
      memberships,
      new NotificationPreferencesService(ds, memberships, { record: () => Promise.resolve() }),
      new FixedClock(now),
      email as never,
    );
  });

  it('notifies every member in-app for handoffs and unions configured recipients with opted-in members', async () => {
    await ds.query('UPDATE workspaces SET settings = $2 WHERE id = $1', [
      workspaceId,
      JSON.stringify({ notificationEmails: ['owner@example.com', 'ops@example.com'] }),
    ]);
    await ds.transaction((manager) =>
      notifications.notify(manager, {
        type: 'handoff_requested',
        workspaceId: workspaceId as never,
        conversationId: '00000000-0000-4000-8000-000000000001',
        botId: '00000000-0000-4000-8000-000000000002',
        actorUserId: null,
        botName: 'Help',
        reason: 'visitor_request',
        contactEmail: null,
        lastMessage: 'I need a person.',
        legacyRecipients: ['owner@example.com', 'ops@example.com'],
      }),
    );

    const rows = await ds.getRepository(NotificationEntity).find({ order: { userId: 'ASC' } });
    expect(rows.map((row) => row.userId).sort()).toEqual([ownerId, adminId, agentId].sort());
    expect(sent.map((message) => message.to).sort()).toEqual([
      'admin@example.com',
      'ops@example.com',
      'owner@example.com',
    ]);
    expect(sent.every((message) => message.template === 'handoff_requested')).toBe(true);
  });

  it('notifies a newly assigned agent but excludes the actor', async () => {
    await ds.transaction((manager) =>
      notifications.notify(manager, {
        type: 'conversation_assigned',
        workspaceId: workspaceId as never,
        conversationId: '00000000-0000-4000-8000-000000000001',
        botId: '00000000-0000-4000-8000-000000000002',
        actorUserId: ownerId as never,
        assigneeUserId: agentId as never,
        actorName: 'Alex',
      }),
    );

    expect(await ds.getRepository(NotificationEntity).find()).toHaveLength(1);
    expect((await ds.getRepository(NotificationEntity).find())[0]?.userId).toBe(agentId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: 'conversation_assigned', to: 'agent@example.com' });
  });

  it('deduplicates visitor reply bursts and hides previews when internal notes exist', async () => {
    const event = {
      type: 'visitor_replied' as const,
      workspaceId: workspaceId as never,
      conversationId: '00000000-0000-4000-8000-000000000001',
      botId: '00000000-0000-4000-8000-000000000002',
      actorUserId: null,
      assigneeUserId: agentId as never,
      preview: 'Private preview must not be shown.',
      hasInternalNotes: true,
    };
    for (let index = 0; index < 50; index++) {
      await ds.transaction((manager) => notifications.notify(manager, event));
    }

    const rows = await ds.getRepository(NotificationEntity).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.body).toBe('A visitor replied in a conversation assigned to you.');
    expect(rows[0]?.payload.body).not.toContain(event.preview);
    expect(sent).toHaveLength(0);
  });

  it('notifies owners and admins of corrections, and only the creator when reviewed', async () => {
    await ds.transaction((manager) =>
      notifications.notify(manager, {
        type: 'suggestion_created',
        workspaceId: workspaceId as never,
        suggestionId: '00000000-0000-4000-8000-000000000003',
        botId: '00000000-0000-4000-8000-000000000002',
        actorUserId: agentId as never,
      }),
    );
    let rows = await ds.getRepository(NotificationEntity).find();
    expect(rows.map((row) => row.userId).sort()).toEqual([ownerId, adminId].sort());

    await ds.getRepository(NotificationEntity).clear();
    await ds.transaction((manager) =>
      notifications.notify(manager, {
        type: 'suggestion_reviewed',
        workspaceId: workspaceId as never,
        suggestionId: '00000000-0000-4000-8000-000000000003',
        botId: '00000000-0000-4000-8000-000000000002',
        actorUserId: adminId as never,
        creatorUserId: agentId as never,
        status: 'approved',
      }),
    );
    rows = await ds.getRepository(NotificationEntity).find();
    expect(rows.map((row) => row.userId)).toEqual([agentId]);
  });
});
