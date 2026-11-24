// SPDX-License-Identifier: AGPL-3.0-only
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { newId } from '../../common/ids';
import { asWorkspaceId, type WorkspaceId } from '../../db/ids';
import { IntegrationLinksRepository } from './integration-links.repository';

let ds: DataSource;
let links: IntegrationLinksRepository;

beforeAll(async () => {
  ds = await getTestDataSource();
  links = new IntegrationLinksRepository(ds);
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

async function fixture(): Promise<{
  workspaceId: WorkspaceId;
  integrationId: string;
  contactId: string;
}> {
  const { user } = await createUser({ ds }, { email: 'crm-links@example.com' });
  const workspace = await createWorkspace({ ds }, user, 'CRM links');
  const workspaceId = asWorkspaceId(workspace.id);
  const integrationId = await one(
    `INSERT INTO integrations (workspace_id, provider, name, status, scopes, transcript_sharing)
     VALUES ($1, 'hubspot', 'Test CRM', 'active', '{}', false)`,
    [workspaceId],
  );
  const contactId = await one('INSERT INTO contacts (workspace_id) VALUES ($1)', [workspaceId]);
  return { workspaceId, integrationId, contactId };
}

async function linkCount(integrationId: string): Promise<number> {
  const rows = await ds.query<{ count: number }[]>(
    'SELECT count(*)::int AS count FROM contact_external_links WHERE integration_id = $1',
    [integrationId],
  );
  return rows[0]?.count ?? 0;
}

describe('IntegrationLinksRepository.upsert', () => {
  it('reuses the existing link when a later event resolves to the same CRM object', async () => {
    const { workspaceId, integrationId, contactId } = await fixture();
    const link = {
      integrationId,
      contactId,
      objectType: 'contact',
      externalObjectId: 'crm-contact-1',
    };

    const first = await links.upsert(workspaceId, { ...link, idempotencyKey: newId() });
    const second = await links.upsert(workspaceId, { ...link, idempotencyKey: newId() });

    expect(second.id).toBe(first.id);
    expect(await linkCount(integrationId)).toBe(1);
  });

  it('is safe when concurrent events link the same CRM object', async () => {
    const { workspaceId, integrationId, contactId } = await fixture();
    const link = {
      integrationId,
      contactId,
      objectType: 'contact',
      externalObjectId: 'crm-contact-1',
    };

    const results = await Promise.all([
      links.upsert(workspaceId, { ...link, idempotencyKey: newId() }),
      links.upsert(workspaceId, { ...link, idempotencyKey: newId() }),
      links.upsert(workspaceId, { ...link, idempotencyKey: newId() }),
    ]);

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await linkCount(integrationId)).toBe(1);
  });
});
