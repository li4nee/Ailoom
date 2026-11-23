// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { newId } from '../../common/ids';
import { asWorkspaceId } from '../../db/ids';
import { IntegrationDeliveriesRepository } from './integration-deliveries.repository';

let ds: DataSource;
let deliveries: IntegrationDeliveriesRepository;

beforeAll(async () => {
  ds = await getTestDataSource();
  deliveries = new IntegrationDeliveriesRepository(ds);
});

beforeEach(async () => {
  await resetDatabase(ds);
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const rows = await ds.query<{ id: string }[]>(`${sql} RETURNING id`, params);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no row from ${sql}`);
  return id;
}

describe('native CRM deliveries', () => {
  it('records a sanitized delivery outcome and prevents duplicate event rows', async () => {
    const { user } = await createUser({ ds }, { email: 'crm-delivery@example.com' });
    const workspace = await createWorkspace({ ds }, user, 'CRM deliveries');
    const workspaceId = asWorkspaceId(workspace.id);
    const integrationId = await one(
      `INSERT INTO integrations (workspace_id, provider, name, status, scopes, transcript_sharing)
       VALUES ($1, 'hubspot', 'Test CRM', 'active', '{}', false)`,
      [workspaceId],
    );
    const eventId = newId();
    const contactId = newId();
    await ds.query(
      `INSERT INTO integration_events
         (id, workspace_id, type, aggregate_id, idempotency_key, data, occurred_at)
       VALUES ($1, $2, 'contact.updated', $3, $4, $5::jsonb, now())`,
      [eventId, workspaceId, contactId, `crm-delivery-${eventId}`, JSON.stringify({ contactId })],
    );

    const concurrentStarts = await Promise.all([
      deliveries.beginAttempt(workspaceId, integrationId, eventId, 'contact.updated'),
      deliveries.beginAttempt(workspaceId, integrationId, eventId, 'contact.updated'),
    ]);
    expect(concurrentStarts.filter(Boolean)).toHaveLength(1);
    await deliveries.finishAttempt(workspaceId, integrationId, eventId, {
      status: 'delivered',
      statusCode: 201,
      durationMs: 31,
      externalObjectType: 'contact',
      externalObjectId: 'external-123',
    });
    const savedStatus = await ds.query<{ status: string }[]>(
      'SELECT status FROM integration_deliveries WHERE integration_id = $1 AND event_id = $2',
      [integrationId, eventId],
    );
    expect(savedStatus[0]?.status).toBe('delivered');
    const retried = await deliveries.beginAttempt(
      workspaceId,
      integrationId,
      eventId,
      'contact.updated',
    );
    const afterRetry = await ds.query<{ status: string }[]>(
      'SELECT status FROM integration_deliveries WHERE integration_id = $1 AND event_id = $2',
      [integrationId, eventId],
    );
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0]?.status).toBe('delivered');
    expect(retried).toBe(false);

    const rows = await deliveries.listForIntegration(workspaceId, integrationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId,
      status: 'delivered',
      attemptCount: 1,
      statusCode: 201,
      durationMs: 31,
      externalObjectType: 'contact',
      externalObjectId: 'external-123',
      lastError: null,
    });
  });
});
