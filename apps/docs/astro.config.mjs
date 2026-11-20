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
            {
              label: 'Self-Hosting',
              items: [
                { label: 'Overview', link: '/self-hosting/' },
                { label: 'Domains and TLS', link: '/self-hosting/domains/' },
                { label: 'Ollama and local models', link: '/self-hosting/ollama/' },
                { label: 'Sizing and scaling', link: '/self-hosting/scaling/' },
              ],
            },
            { label: 'Widget', link: '/widget/' },
            { label: 'Integrations', link: '/integrations/' },
            { label: 'Agent productivity', link: '/agent-productivity/' },
            { label: 'Agent-assist evaluation', link: '/agent-assist-evaluation/' },
            { label: 'Data handling', link: '/data-handling/' },
            { label: 'FAQ', link: '/faq/' },
          ],
        },
        {
          label: 'Operations',
          items: [
            { label: 'Security', link: '/security/' },
            { label: 'Backups', link: '/backups/' },
            { label: 'Upgrades', link: '/upgrades/' },
            { label: 'Troubleshooting', link: '/troubleshooting/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', link: '/configuration/' },
            {
              label: 'Providers',
              items: [
                { label: 'Overview', link: '/providers/' },
                { label: 'OpenAI', link: '/providers/openai/' },
                { label: 'Anthropic', link: '/providers/anthropic/' },
                { label: 'Gemini', link: '/providers/gemini/' },
                { label: 'Groq', link: '/providers/groq/' },
                { label: 'Mistral', link: '/providers/mistral/' },
                { label: 'Ollama', link: '/providers/ollama/' },
                { label: 'OpenAI-compatible', link: '/providers/openai-compatible/' },
                { label: 'Built-in local', link: '/providers/local/' },
              ],
            },
            { label: 'Architecture', link: '/architecture/' },
            { label: 'Licensing', link: '/licensing/' },
          ],
        },
      ],
    }),
  ],
});
