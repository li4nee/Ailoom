// SPDX-License-Identifier: AGPL-3.0-only
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles the Nest decorators (and emits decorator metadata); esbuild cannot.
const plugins = [swc.vite({ module: { type: 'es6' } })];

// `int` and `e2e` run against one real Postgres (Testcontainers) started once per run.
// Files run one after another because they share that database and reset it between tests.
const realDatabase = {
  globalSetup: ['./test/global-setup.int.ts'],
  setupFiles: ['./test/setup.ts'],
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 60_000,
};

export default defineConfig({
  test: {
    // `int` and `e2e` have no files yet; an empty project must not fail CI.
    passWithNoTests: true,
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int.spec.ts', '**/node_modules/**', '**/dist/**'],
        },
      },
      {
        plugins,
        test: {
          name: 'int',
          include: ['src/**/*.int.spec.ts'],
          ...realDatabase,
        },
      },
      {
        plugins,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.spec.ts'],
          ...realDatabase,
        },
      },
    ],
  },
});
