// SPDX-License-Identifier: AGPL-3.0-only
import type { PinoLogger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { SecretBox } from '../../common/crypto';
import { asWorkspaceId } from '../../db/ids';
import { CredentialsRepository } from './credentials.repository';
import { ReencryptProcessor } from './reencrypt.processor';

const V1 = { version: 1, key: Buffer.alloc(32, 1) };
const V2 = { version: 2, key: Buffer.alloc(32, 2) };

const logger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
} as unknown as PinoLogger;

let ds: DataSource;
let workspaceId: string;

beforeAll(async () => {
  ds = await getTestDataSource();
});

afterAll(async () => {
  // The data source is shared by the worker's other test files.
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user } = await createUser({ ds }, { email: 'rotate@example.com' });
  workspaceId = (await createWorkspace({ ds }, user, 'Rotate')).id;
});

/** Inserts `count` credentials sealed with the v1 key. */
async function seedV1(count: number, plain = 'sk-rotate-me'): Promise<void> {
  const sealed = new SecretBox([V1]).seal(plain);
  await ds.query(
    `INSERT INTO provider_credentials
       (workspace_id, provider, label, secret_ciphertext, secret_iv, secret_tag, key_version, secret_last4)
     SELECT $1, 'mock', 'credential ' || g, $2, $3, $4, 1, 'e-me'
       FROM generate_series(1, $5) g`,
    [workspaceId, sealed.ciphertext, sealed.iv, sealed.tag, count],
  );
}

async function keyVersions(): Promise<number[]> {
  const rows = await ds.query<{ key_version: number }[]>(
    'SELECT key_version FROM provider_credentials ORDER BY label',
  );
  return rows.map((row) => row.key_version);
}

async function storedSealed(): Promise<
  { secret_ciphertext: Buffer; secret_iv: Buffer; secret_tag: Buffer; key_version: number }[]
> {
  return ds.query(
    `SELECT secret_ciphertext, secret_iv, secret_tag, key_version
       FROM provider_credentials ORDER BY label`,
  );
}

function processor(ring: { version: number; key: Buffer }[]): ReencryptProcessor {
  return new ReencryptProcessor(new CredentialsRepository(ds), new SecretBox(ring), logger);
}

const context = () => ({ jobId: 'job-1', attempt: 1, signal: new AbortController().signal });

describe('credentials re-encryption', () => {
  it('re-seals every row whose key version is not active', async () => {
    await seedV1(3);

    await processor([V2, V1]).handle({}, context());

    expect(await keyVersions()).toEqual([2, 2, 2]);
    const onlyV2 = new SecretBox([V2]);
    for (const row of await storedSealed()) {
      expect(
        onlyV2.open({
          ciphertext: row.secret_ciphertext,
          iv: row.secret_iv,
          tag: row.secret_tag,
          keyVersion: row.key_version,
        }),
      ).toBe('sk-rotate-me');
    }
  });

  it('walks every batch when there are more rows than one batch holds', async () => {
    await seedV1(101);

    await processor([V2, V1]).handle({}, context());

    const versions = await keyVersions();
    expect(versions).toHaveLength(101);
    expect(new Set(versions)).toEqual(new Set([2]));
  });

  it('does nothing when the active key already sealed every row', async () => {
    await seedV1(2);
    const active = processor([V2, V1]);
    await active.handle({}, context());
    const before = await storedSealed();

    await active.handle({}, context());

    expect(await storedSealed()).toEqual(before);
  });

  it('fails loudly when a row was sealed with a key that is no longer configured', async () => {
    await seedV1(1);

    await expect(processor([V2]).handle({}, context())).rejects.toThrow(/version 1/);
    expect(await keyVersions()).toEqual([1]);
  });

  it('works for credentials of every workspace', async () => {
    await seedV1(1);
    const { user } = await createUser({ ds }, { email: 'second@example.com' });
    const other = await createWorkspace({ ds }, user, 'Other');
    const sealed = new SecretBox([V1]).seal('sk-other');
    await ds.query(
      `INSERT INTO provider_credentials
         (workspace_id, provider, label, secret_ciphertext, secret_iv, secret_tag, key_version)
       VALUES ($1, 'mock', 'zz other', $2, $3, $4, 1)`,
      [asWorkspaceId(other.id), sealed.ciphertext, sealed.iv, sealed.tag],
    );

    await processor([V2, V1]).handle({}, context());

    expect(await keyVersions()).toEqual([2, 2]);
  });
});
