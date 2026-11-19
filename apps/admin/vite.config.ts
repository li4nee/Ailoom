// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'AILOOM_DEV_');

  return {
    // The router plugin must run before React so it can split route files.
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      }),
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      // Dev only: the API runs on :3000; in production Caddy serves both on one origin.
      proxy: {
        '/api': {
          target: env['AILOOM_DEV_API_PROXY'] ?? 'http://localhost:3000',
          configure(proxy) {
            const origin = env['AILOOM_DEV_API_ORIGIN'];
            proxy.on('proxyReq', (request, incoming) => {
              // The widget API validates the embedding page's origin; preserve it for local host reviews.
              if (incoming.url?.startsWith('/api/widget/')) return;
              if (origin !== undefined) request.setHeader('origin', origin);
            });
          },
        },
      },
    },
  };
});
