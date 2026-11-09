// SPDX-License-Identifier: MIT
import type { ESLint } from 'eslint';

import { noAgplImport } from './rules/no-agpl-import.js';
import { noProcessEnv } from './rules/no-process-env.js';
import { spdxHeader } from './rules/spdx-header.js';
import { tenantRepository } from './rules/tenant-repository.js';

export const rules = {
  'tenant-repository': tenantRepository,
  'no-process-env': noProcessEnv,
  'spdx-header': spdxHeader,
  'no-agpl-import': noAgplImport,
};

/** ESLint plugin registered under the `local` namespace. */
export const plugin = {
  meta: { name: '@app/eslint-config/local', version: '0.0.0' },
  rules,
} as unknown as ESLint.Plugin;
