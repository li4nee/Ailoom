// SPDX-License-Identifier: MIT
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RuleTester } from '@typescript-eslint/rule-tester';
import { describe, expect, it } from 'vitest';

import { isTestFile, tenantRepository } from '../../src/rules/tenant-repository.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tenant');

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: fixtures,
    },
  },
});

const header = "import type { BotEntity, Repository, UserEntity } from './entities.js';\n";
const botCall = `${header}declare const repo: Repository<BotEntity>;\nrepo.findOneBy({ id: '1' });`;

ruleTester.run('tenant-repository', tenantRepository, {
  valid: [
    { code: botCall, filename: 'bots.repository.ts' },
    {
      code: `${header}declare const repo: Repository<UserEntity>;\nrepo.findOneBy({ id: '1' });`,
      filename: 'users.service.ts',
    },
    {
      code: `${header}declare const bots: { findOneBy(id: string): void };\nbots.findOneBy('1');`,
      filename: 'bots.service.ts',
    },
  ],
  invalid: [
    {
      code: botCall,
      filename: 'bots.service.ts',
      errors: [{ messageId: 'tenantRepositoryOnly' }],
    },
    {
      code: `${header}class S { constructor(private readonly repo: Repository<BotEntity>) {}\n  run() { return this.repo.save({ id: '1', workspaceId: 'w' }); } }\nexport { S };`,
      filename: 'bots.service.ts',
      errors: [{ messageId: 'tenantRepositoryOnly' }],
    },
    {
      code: `${header}declare const repo: Repository<BotEntity>;\nvoid repo.find();\nvoid repo.count();\nvoid repo.delete({ id: '1' });`,
      filename: 'bots.service.ts',
      errors: [
        { messageId: 'tenantRepositoryOnly' },
        { messageId: 'tenantRepositoryOnly' },
        { messageId: 'tenantRepositoryOnly' },
      ],
    },
  ],
});

describe('isTestFile', () => {
  const cwd = '/repo/apps/api';

  it('exempts spec files', () => {
    expect(isTestFile('/repo/apps/api/src/bots.service.spec.ts', cwd)).toBe(true);
  });

  it('exempts a package test directory', () => {
    expect(isTestFile('/repo/apps/api/test/helpers/db.ts', cwd)).toBe(true);
  });

  it('does not exempt production code', () => {
    expect(isTestFile('/repo/apps/api/src/bots.service.ts', cwd)).toBe(false);
  });
});
