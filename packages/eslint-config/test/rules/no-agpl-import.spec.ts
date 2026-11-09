// SPDX-License-Identifier: MIT
import { RuleTester } from '@typescript-eslint/rule-tester';

import { noAgplImport } from '../../src/rules/no-agpl-import.js';

const ruleTester = new RuleTester();

const options = [{ forbidden: ['@app/api', '@app/admin'], forbiddenPathSegments: ['/apps/'] }] as const;

ruleTester.run('no-agpl-import', noAgplImport, {
  valid: [
    { code: "import { z } from 'zod';", options },
    { code: "import x from '@app/shared';", options },
    { code: "import x from '@app/apifoo';", options },
    { code: "export { y } from './local.js';", options },
    { code: 'export const a = 1;', options },
    { code: "const m = await import('zod');", options },
  ],
  invalid: [
    { code: "import x from '@app/api/src/x';", options, errors: [{ messageId: 'agplImport' }] },
    { code: "import x from '../../../apps/api/src/x';", options, errors: [{ messageId: 'agplImport' }] },
    { code: "export * from '@app/admin';", options, errors: [{ messageId: 'agplImport' }] },
    { code: "export { y } from '@app/api';", options, errors: [{ messageId: 'agplImport' }] },
    { code: "const m = await import('@app/admin');", options, errors: [{ messageId: 'agplImport' }] },
    { code: "import type { T } from '@app/api';", options, errors: [{ messageId: 'agplImport' }] },
  ],
});
