// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const sharedSource = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Tests resolve @app/shared from source, so a stale dist/ cannot mask a change.
  resolve: {
    alias: { '@app/shared': sharedSource, '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    restoreMocks: true,
  },
});
