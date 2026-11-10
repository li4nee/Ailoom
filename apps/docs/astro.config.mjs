// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

export default defineConfig({
  integrations: [
    starlight({
      title: 'AiLoom',
      description: 'Self-hosted AI customer support platform — documentation',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/li4nee/ailoom' }],
      lastUpdated: true,
      plugins: [starlightLinksValidator()],
      sidebar: [
        {
          label: 'Guide',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Getting Started', link: '/getting-started/' },
            { label: 'Self-Hosting', link: '/self-hosting/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', link: '/configuration/' },
            { label: 'Providers', link: '/providers/' },
            { label: 'Architecture', link: '/architecture/' },
          ],
        },
      ],
    }),
  ],
});
