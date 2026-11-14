// SPDX-License-Identifier: MIT
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** The lazy-loaded app bundle: ES module at `dist/<version>/main.js`. */
export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'copy-i18n',
      // Locale files are fetched at runtime from `/widget/<version>/i18n/<locale>.json`.
      closeBundle() {
        const source = 'src/main/i18n';
        const target = `dist/${pkg.version}/i18n`;
        mkdirSync(target, { recursive: true });
        for (const file of readdirSync(source)) {
          if (file.endsWith('.json')) copyFileSync(`${source}/${file}`, `${target}/${file}`);
        }
      },
    },
  ],
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
