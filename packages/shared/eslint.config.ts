// SPDX-License-Identifier: MIT
import { createConfig } from '@app/eslint-config';

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  license: 'MIT',
  forbiddenImports: ['@app/api', '@app/admin'],
});
