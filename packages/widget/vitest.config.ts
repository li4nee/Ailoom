// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  // Tests resolve @app/shared from source, so a stale dist/ cannot mask a change.
  resolve: {
    alias: {
      '@app/shared/widget-limits': fileURLToPath(
        new URL('../shared/src/widget-limits.ts', import.meta.url),
      ),
      '@app/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  define: { __WIDGET_VERSION__: JSON.stringify('0.1.0') },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.{ts,tsx}'],
    restoreMocks: true,
  },
});
