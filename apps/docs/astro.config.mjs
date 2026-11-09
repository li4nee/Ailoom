import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'AiLoom',
      description: 'Customer support platform documentation',
      social: {
        github: 'https://github.com/li4nee/ailoom',
      },
      customCss: [],
      lastUpdated: true,
      sidebar: [
        {
          label: 'Guide',
          items: [
            { label: 'Introduction', link: '/index' },
            { label: 'Getting Started', link: '/getting-started' },
            { label: 'Self-Hosting', link: '/self-hosting' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', link: '/configuration' },
            { label: 'Providers', link: '/providers/' },
            { label: 'Architecture', link: '/architecture' },
          ],
        },
      ],
    }),
  ],
});
