// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles the Nest decorators (and emits decorator metadata); esbuild cannot.
const plugins = [swc.vite({ module: { type: 'es6' } })];
const sharedSource = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

// Every project runs this first: it refuses any network connection except to localhost, so
// no test can reach the real network.
const setupFiles = ['./test/setup.ts'];

// `int` and `e2e` run against one real Postgres (Testcontainers) started once per run.
// Files run one after another because they share that database and reset it between tests.
const realDatabase = {
  globalSetup: ['./test/global-setup.int.ts'],
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  // Tests resolve @app/shared from source, so a stale dist/ cannot mask a change.
  resolve: { alias: { '@app/shared': sharedSource } },
  test: {
    // `int` and `e2e` have no files yet; an empty project must not fail CI.
    passWithNoTests: true,
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          setupFiles,
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int.spec.ts', '**/node_modules/**', '**/dist/**'],
        },
      },
      {
        plugins,
        test: {
          name: 'int',
          include: ['src/**/*.int.spec.ts'],
          setupFiles,
          ...realDatabase,
        },
      },
      {
        plugins,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.spec.ts'],
          setupFiles,
          ...realDatabase,
        },
      },
    ],
  },
});
