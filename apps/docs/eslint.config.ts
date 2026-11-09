// SPDX-License-Identifier: AGPL-3.0-only
import { createConfig } from '@app/eslint-config';

export default [
  ...createConfig({
    tsconfigRootDir: import.meta.dirname,
    license: 'AGPL-3.0-only',
  }),
];
