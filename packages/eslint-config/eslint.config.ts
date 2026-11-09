// SPDX-License-Identifier: MIT
import { globalIgnores } from 'eslint/config';

import { createConfig } from './src/index.js';

export default [
  globalIgnores(['test/fixtures/**']),
  ...createConfig({
    tsconfigRootDir: import.meta.dirname,
    license: 'MIT',
    forbiddenImports: ['@app/api', '@app/admin'],
  }),
];
