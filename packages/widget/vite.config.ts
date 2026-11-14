// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** The lazy-loaded app bundle: ES module at `dist/<version>/main.js`. */
export default defineConfig({
  plugins: [preact()],
  define: { __WIDGET_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: `dist/${pkg.version}`,
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/main/index.tsx', import.meta.url)),
      formats: ['es'],
      fileName: () => 'main.js',
    },
  },
});
