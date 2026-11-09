// SPDX-License-Identifier: AGPL-3.0-only
import { Column, DataSource, Entity, PrimaryColumn, Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';

import { testDataSourceOptions } from '../../test/helpers/db';
import { asWorkspaceId, type WorkspaceId } from './ids';
import { TenantEntity } from './tenant-entity';
import { TenantRepository } from './tenant.repository';

@Entity({ name: '__test_things' })
class TestThingEntity extends TenantEntity {
  @PrimaryColumn('uuid')
  override id!: string;

  @Column('uuid', { name: 'workspace_id' })
  override workspaceId!: WorkspaceId;

  @Column('text')
  name!: string;
}

class TestThingRepository extends TenantRepository<TestThingEntity> {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- base constructor is protected
  constructor(repo: Repository<TestThingEntity>) {
    super(repo);
  }
}

const WS_A = asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c01');
const WS_B = asWorkspaceId('0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5c02');
const ID_1 = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5d01';
const ID_2 = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5d02';
const ID_3 = '0192f8a1-7c3e-7a4b-9c2d-1e2f3a4b5d03';

describe('TenantRepository', () => {
  let ds: DataSource;
  let repo: TestThingRepository;

  beforeAll(async () => {
    ds = new DataSource(
      testDataSourceOptions(inject('databaseUrl'), {
        entities: [TestThingEntity],
        migrations: [],
      }),
    );
    await ds.initialize();
    await ds.query(
      `CREATE TABLE __test_things (
         id uuid PRIMARY KEY DEFAULT uuidv7(),
         workspace_id uuid NOT NULL,
         name text NOT NULL
       )`,
    );
    repo = new TestThingRepository(ds.getRepository(TestThingEntity));
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE TABLE __test_things');
  });

  afterAll(async () => {
    await ds.query('DROP TABLE IF EXISTS __test_things');
    await ds.destroy();
  });

  it('never returns rows from another workspace', async () => {
    const a = await repo.insert(WS_A, { name: 'a' });
    expect(await repo.findById(WS_B, a.id)).toBeNull();
    await expect(repo.getById(WS_B, a.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses cross-workspace update and delete', async () => {
    const a = await repo.insert(WS_A, { name: 'a' });
    await expect(repo.updateById(WS_B, a.id, { name: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(repo.deleteById(WS_B, a.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await repo.getById(WS_A, a.id)).name).toBe('a');
  });

  it('forces the workspace on insert even when data says otherwise', async () => {
    const row = await repo.insert(WS_B, { name: 'b', workspaceId: WS_A });
    expect(row.workspaceId).toBe(WS_B);
    expect(await repo.findById(WS_A, row.id)).toBeNull();
  });

  it('paginates newest first with cursors', async () => {
    await repo.insert(WS_A, { id: ID_1, name: '1' });
    await repo.insert(WS_A, { id: ID_2, name: '2' });
    await repo.insert(WS_A, { id: ID_3, name: '3' });

    const p1 = await repo.list(WS_A, { limit: 2, cursor: null });
    expect(p1.data.map((row) => row.name)).toEqual(['3', '2']);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await repo.list(WS_A, { limit: 2, cursor: p1.nextCursor });
    expect(p2.data.map((row) => row.name)).toEqual(['1']);
    expect(p2.nextCursor).toBeNull();
  });

  it('returns a custom not-found code from getById', async () => {
    await expect(repo.getById(WS_A, ID_1, 'conflict')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('treats malformed ids as not found', () => {
    expect(() => asWorkspaceId('nope')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
});
