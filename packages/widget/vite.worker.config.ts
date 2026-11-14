// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** The proof-of-work worker: `dist/<version>/challenge-worker.js`, outside the main budget. */
export default defineConfig({
  define: { __WIDGET_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: `dist/${pkg.version}`,
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/challenge/worker.ts', import.meta.url)),
      formats: ['iife'],
      name: 'AiloomChallengeWorker',
      fileName: () => 'challenge-worker.js',
    },
  },
});
