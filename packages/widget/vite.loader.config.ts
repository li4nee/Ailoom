// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** The `<script>`-tag loader: one IIFE at `dist/widget.js`, budgeted at 3 KB gzip. */
export default defineConfig({
  define: { __WIDGET_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/loader/index.ts', import.meta.url)),
      name: 'AiloomChatLoader',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
});
