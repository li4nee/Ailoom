// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MemoryStorage } from '../../src/common/storage';
import { createTestApp, type TestApp } from '../helpers/app';
import { resetDatabase } from '../helpers/db';
import {
  authed,
  type AuthedClient,
  createUser,
  createWorkspace,
  loginAs,
} from '../helpers/factories';

interface ErrorBody {
  error: { code: string };
}

interface SourceBody {
  id: string;
  botId: string;
  type: string;
  title: string;
  status: string;
  error: string | null;
  pagesTotal: number;
  pagesDone: number;
}

const FIXTURES = join(__dirname, '..', 'fixtures', 'files');
let emailSeq = 0;

function nextEmail(): string {
  emailSeq += 1;
  return `sources${String(emailSeq)}@example.com`;
}

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe('knowledge sources api', () => {
  let t: TestApp;
  let storage: MemoryStorage;
  let owner: AuthedClient;
  let workspaceId: string;
  let botId: string;

  beforeAll(async () => {
    storage = new MemoryStorage();
    t = await createTestApp({ config: { maxUploadMb: 1 }, storage });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.ds);
    storage.blobs.clear();
    const { user, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    workspaceId = (await createWorkspace(t, user, 'Acme')).id;
    owner = authed(t, await loginAs(t, user, password));

    // The factory inserts the workspace directly, so `workspace.created` never fired: create
    // the built-in row the listener would have provisioned.
    await t.ds.query(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'local', 'Built-in (local)')`,
      [workspaceId],
    );

    const credential = await owner
      .post(`/api/v1/workspaces/${workspaceId}/credentials`)
      .send({ provider: 'mock', label: 'Chat' });
    if (credential.status !== 201) throw new Error(`credential: ${credential.text}`);
    const bot = await owner.post(`/api/v1/workspaces/${workspaceId}/bots`).send({
      name: 'Help',
      chatCredentialId: (credential.body as { id: string }).id,
      chatModel: 'mock-chat',
    });
    if (bot.status !== 201) throw new Error(`bot: ${bot.text}`);
    botId = (bot.body as { id: string }).id;
  });

  function url(path = ''): string {
    return `/api/v1/workspaces/${workspaceId}/bots/${botId}/sources${path}`;
  }

  function codeOf(body: unknown): string {
    return (body as ErrorBody).error.code;
  }

  async function jobsFor(sourceId: string): Promise<string[]> {
    const rows = await t.ds.query<{ name: string }[]>(
      `SELECT name FROM pgboss.job WHERE data->>'sourceId' = $1 ORDER BY name`,
      [sourceId],
    );
    return rows.map((row) => row.name);
  }

  it('creates a text source and enqueues ingestion atomically', async () => {
    const res = await owner.post(url()).send({
      type: 'text',
      title: 'Refunds',
      body: '# Refunds\nYou can return items within 30 days.',
    });

    expect(res.status).toBe(201);
    const source = res.body as SourceBody;
    expect(source).toMatchObject({ type: 'text', status: 'pending', pagesTotal: 0 });
    expect(await jobsFor(source.id)).toEqual(['knowledge.ingest_source']);
  });

  it('rejects text over 200 KB', async () => {
    const res = await owner.post(url()).send({
      type: 'text',
      title: 'Huge',
      body: 'a'.repeat(200 * 1024 + 1),
    });

    expect(res.status).toBe(400);
    expect(codeOf(res.body)).toBe('validation_failed');
  });

  it('rejects private and non-http URLs early', async () => {
    const privateUrl = await owner.post(url()).send({ type: 'url', url: 'http://10.0.0.1/x' });
    expect(privateUrl.status).toBe(400);
    expect(codeOf(privateUrl.body)).toBe('blocked_url');

    const ftp = await owner.post(url()).send({ type: 'url', url: 'ftp://ex.com/x' });
    expect(ftp.status).toBe(400);
    expect(codeOf(ftp.body)).toBe('validation_failed');
  });

  it('accepts a PDF upload and stores the blob under a workspace key', async () => {
    const res = await owner
      .post(url('/upload'))
      .attach('file', fixture('sample.pdf'), 'sample.pdf')
      .field('title', 'Manual');

    expect(res.status).toBe(201);
    const source = res.body as SourceBody;
    expect(source).toMatchObject({ type: 'file', title: 'Manual', status: 'pending' });

    const rows = await t.ds.query<{ storage_key: string }[]>(
      `SELECT f.storage_key FROM files f WHERE f.workspace_id = $1`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storage_key).toMatch(new RegExp(`^${workspaceId}/`));
    expect(storage.blobs.has(rows[0]?.storage_key ?? '')).toBe(true);
  });

  it('rejects a disguised file by magic bytes', async () => {
    const res = await owner
      .post(url('/upload'))
      .attach('file', Buffer.from('<!doctype html><p>not a pdf</p>'), 'invoice.pdf');

    expect(res.status).toBe(415);
    expect(codeOf(res.body)).toBe('unsupported_file_type');
    expect(storage.blobs.size).toBe(0);
  });

  it('rejects oversized uploads', async () => {
    const res = await owner
      .post(url('/upload'))
      .attach('file', Buffer.alloc(2 * 1024 * 1024, 0x61), 'notes.txt');

    expect(res.status).toBe(413);
    expect(codeOf(res.body)).toBe('payload_too_large');
  });

  it('resync twice quickly runs one job', async () => {
    const created = await owner.post(url()).send({ type: 'text', title: 'Refunds', body: 'hello' });
    const source = created.body as SourceBody;
    await t.ds.query(`DELETE FROM pgboss.job WHERE data->>'sourceId' = $1`, [source.id]);

    const first = await owner.post(url(`/${source.id}/resync`));
    const second = await owner.post(url(`/${source.id}/resync`));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await jobsFor(source.id)).toEqual(['knowledge.ingest_source']);
  });

  it('delete returns 202 and marks the source deleting', async () => {
    const created = await owner.post(url()).send({ type: 'text', title: 'Refunds', body: 'hello' });
    const source = created.body as SourceBody;

    const res = await owner.delete(url(`/${source.id}`));
    expect(res.status).toBe(202);

    const after = await owner.get(url(`/${source.id}`));
    expect((after.body as SourceBody).status).toBe('deleting');
    expect(await jobsFor(source.id)).toContain('knowledge.delete_source');
  });

  it('agents cannot add knowledge', async () => {
    const { user: agent, password } = await createUser({ ds: t.ds }, { email: nextEmail() });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [workspaceId, agent.id],
    );
    const agentClient = authed(t, await loginAs(t, agent, password));

    expect((await agentClient.get(url())).status).toBe(403);
    const res = await agentClient
      .post(url())
      .send({ type: 'text', title: 'Refunds', body: 'hello' });
    expect(res.status).toBe(403);
  });
});
