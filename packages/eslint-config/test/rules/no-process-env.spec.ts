// SPDX-License-Identifier: MIT
import { RuleTester } from '@typescript-eslint/rule-tester';

import { noProcessEnv } from '../../src/rules/no-process-env.js';

const ruleTester = new RuleTester();

const allow = [
  'src/common/config/**',
  'src/main.ts',
  'src/worker.ts',
  'src/migrate.ts',
  'src/cli/**',
  'src/db/cli-data-source.ts',
];
const options = [{ allow }] as const;
const code = 'const x = process.env.X;';

ruleTester.run('no-process-env', noProcessEnv, {
  valid: [
    { code, filename: 'src/common/config/load-config.ts', options: [{ allow }] },
    { code, filename: 'src/main.ts', options: [{ allow }] },
    { code, filename: 'src/cli/seed/run.ts', options: [{ allow }] },
    { code: 'const { env } = process;', filename: 'src/worker.ts', options: [{ allow }] },
    {
      code: 'const { argv } = process;',
      filename: 'src/modules/bots/bots.service.ts',
      options: [{ allow }],
    },
    {
      code: 'const env = {}; env.X = 1;',
      filename: 'src/modules/bots/bots.service.ts',
      options: [{ allow }],
    },
  ],
  invalid: [
    {
      code,
      filename: 'src/modules/bots/bots.service.ts',
      options,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      code: 'const { env } = process;',
      filename: 'src/modules/bots/bots.service.ts',
      options,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      code: "const x = process['env'];",
      filename: 'src/modules/bots/bots.service.ts',
      options,
      errors: [{ messageId: 'noProcessEnv' }],
    },
    {
      code,
      filename: 'src/modules/bots/bots.service.ts',
      errors: [{ messageId: 'noProcessEnv' }],
    },
  ],
});
