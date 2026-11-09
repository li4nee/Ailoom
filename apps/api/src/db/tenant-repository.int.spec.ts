// SPDX-License-Identifier: AGPL-3.0-only
import {
  Column,
  DataSource,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Repository,
} from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';

import { testDataSourceOptions } from '../../test/helpers/db';
import { asWorkspaceId, type WorkspaceId } from './ids';
import { TenantEntity } from './tenant-entity';
import { TenantRepository } from './tenant.repository';

/** Stands in for the workspace table: it only gives the test entity a relation to patch. */
@Entity({ name: '__test_owners' })
class TestOwnerEntity {
  @PrimaryColumn('uuid')
  id!: string;
}

@Entity({ name: '__test_things' })
class TestThingEntity extends TenantEntity {
  // The default must be declared like the real entities do, or TypeORM does not read the
  // database-generated id back after an insert.
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column('uuid', { name: 'workspace_id' })
  override workspaceId!: WorkspaceId;

  // Same shape as the real entities: a relation sharing the `workspace_id` column.
  @ManyToOne(() => TestOwnerEntity)
  @JoinColumn({ name: 'workspace_id' })
  workspace!: TestOwnerEntity;

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
        entities: [TestThingEntity, TestOwnerEntity],
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

  it('forces the workspace on insert even when a relation in data points elsewhere', async () => {
    const row = await repo.insert(WS_B, { name: 'b', workspace: { id: WS_A } });
    expect(row.workspaceId).toBe(WS_B);
    expect(await repo.findById(WS_A, row.id)).toBeNull();
  });

  describe('insert with a caller-supplied id', () => {
    it('rejects an id that belongs to another workspace and leaves that row untouched', async () => {
      await repo.insert(WS_A, { id: ID_1, name: 'a' });

      await expect(repo.insert(WS_B, { id: ID_1, name: 'hijacked' })).rejects.toMatchObject({
        code: 'conflict',
      });

      const original = await repo.getById(WS_A, ID_1);
      expect(original.name).toBe('a');
      expect(original.workspaceId).toBe(WS_A);
      expect(await repo.findById(WS_B, ID_1)).toBeNull();
      expect(await ds.query('SELECT count(*)::int AS n FROM __test_things')).toEqual([{ n: 1 }]);
    });

    it('rejects an id that already exists in the same workspace instead of updating it', async () => {
      await repo.insert(WS_A, { id: ID_1, name: 'first' });

      await expect(repo.insert(WS_A, { id: ID_1, name: 'second' })).rejects.toMatchObject({
        code: 'conflict',
      });

      expect((await repo.getById(WS_A, ID_1)).name).toBe('first');
    });

    it('keeps the unique violation as the cause of the conflict', async () => {
      await repo.insert(WS_A, { id: ID_1, name: 'a' });
      const duplicate = repo.insert(WS_A, { id: ID_1, name: 'b' });
      await expect(duplicate).rejects.toMatchObject({ code: 'conflict', status: 409 });
      await expect(duplicate).rejects.toHaveProperty('cause.code', '23505');
    });

    it('accepts a free caller-supplied id and returns the stored row', async () => {
      const row = await repo.insert(WS_A, { id: ID_1, name: 'a' });
      expect(row).toMatchObject({ id: ID_1, workspaceId: WS_A, name: 'a' });
    });

    it('rejects a malformed caller-supplied id as invalid, not as a server error', async () => {
      await expect(repo.insert(WS_A, { id: 'nope', name: 'a' })).rejects.toMatchObject({
        code: 'validation_failed',
      });
    });
  });

  describe('updateById', () => {
    it('refuses a patch that moves the row to another workspace', async () => {
      const a = await repo.insert(WS_A, { name: 'a' });

      await expect(
        repo.updateById(WS_A, a.id, { workspaceId: WS_B, name: 'moved' }),
      ).rejects.toMatchObject({ code: 'validation_failed' });

      const row = await repo.getById(WS_A, a.id);
      expect(row).toMatchObject({ workspaceId: WS_A, name: 'a' });
      expect(await repo.findById(WS_B, a.id)).toBeNull();
    });

    it('refuses a patch that changes the primary key', async () => {
      const a = await repo.insert(WS_A, { id: ID_1, name: 'a' });

      await expect(repo.updateById(WS_A, a.id, { id: ID_2 })).rejects.toMatchObject({
        code: 'validation_failed',
      });

      expect(await repo.findById(WS_A, ID_1)).not.toBeNull();
      expect(await repo.findById(WS_A, ID_2)).toBeNull();
    });

    it('refuses a patch that reaches workspace_id through a relation', async () => {
      const a = await repo.insert(WS_A, { name: 'a' });

      await expect(repo.updateById(WS_A, a.id, { workspace: { id: WS_B } })).rejects.toMatchObject({
        code: 'validation_failed',
      });

      expect((await repo.getById(WS_A, a.id)).workspaceId).toBe(WS_A);
    });

    it('still applies an ordinary patch', async () => {
      const a = await repo.insert(WS_A, { name: 'a' });
      const updated = await repo.updateById(WS_A, a.id, { name: 'renamed' });
      expect(updated).toMatchObject({ id: a.id, workspaceId: WS_A, name: 'renamed' });
    });
  });

  describe('malformed ids', () => {
    it('findById returns null', async () => {
      expect(await repo.findById(WS_A, 'nope')).toBeNull();
    });

    it('getById throws not_found, or the custom code', async () => {
      await expect(repo.getById(WS_A, 'nope')).rejects.toMatchObject({ code: 'not_found' });
      await expect(repo.getById(WS_A, 'nope', 'conflict')).rejects.toMatchObject({
        code: 'conflict',
      });
    });

    it('updateById throws not_found', async () => {
      await expect(repo.updateById(WS_A, 'nope', { name: 'x' })).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('deleteById throws not_found', async () => {
      await expect(repo.deleteById(WS_A, 'nope')).rejects.toMatchObject({ code: 'not_found' });
    });
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
