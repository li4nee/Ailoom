// SPDX-License-Identifier: AGPL-3.0-only
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const pagesBase = '/Ailoom';

export default defineConfig({
  site: 'https://li4nee.github.io',
  base: pagesBase,
  integrations: [
    starlight({
      title: 'AiLoom',
      description: 'Self-hosted AI customer support platform — documentation',
      customCss: ['./src/styles/custom.css'],
      components: { Hero: './src/components/DocsHero.astro' },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/li4nee/ailoom' }],
      lastUpdated: true,
      sidebar: [
        {
          label: 'Guide',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Getting Started', link: '/getting-started/' },
            {
              label: 'Self-Hosting',
              collapsed: true,
              items: [
                { label: 'Overview', link: '/self-hosting/' },
                { label: 'Domains and TLS', link: '/self-hosting/domains/' },
                { label: 'Ollama and local models', link: '/self-hosting/ollama/' },
                { label: 'Sizing and scaling', link: '/self-hosting/scaling/' },
              ],
            },
            { label: 'Widget', link: '/widget/' },
            {
              label: 'Integrations',
              collapsed: true,
              items: [
                { label: 'Overview', link: '/integrations/' },
                { label: 'HubSpot', link: '/integrations/hubspot/' },
                { label: 'Pipedrive', link: '/integrations/pipedrive/' },
                { label: 'Intercom', link: '/integrations/intercom/' },
              ],
            },
            { label: 'Agent productivity', link: '/agent-productivity/' },
            { label: 'Knowledge freshness', link: '/knowledge-freshness/' },
            { label: 'Analytics', link: '/analytics/' },
            { label: 'Agent-assist evaluation', link: '/agent-assist-evaluation/' },
            { label: 'Evaluation suite', link: '/eval-suite/' },
            { label: 'Answer verification', link: '/answer-verification/' },
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
            { label: 'Tools and MCP', link: '/tool-calling/' },
            {
              label: 'Providers',
              collapsed: true,
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
