// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { BotDto, Role } from '@app/shared';

import { BotAppearanceForm } from './components/bot-appearance-form';
import { BotBehaviorForm } from './components/bot-behavior-form';
import { BotCreateForm } from './components/bot-create-form';
import { BotGeneralForm } from './components/bot-general-form';
import { BotInstall } from './components/bot-install';
import { BotInstructions } from './components/bot-instructions';
import { BotsList } from './components/bots-list';
import { contrastText } from './contrast';
import { buildEmbedSnippet } from './embed-snippet';

const WS = 'w1';
const BOT_ID = 'b1';
const ADMIN: Role = 'admin';
const AGENT: Role = 'agent';

const BOT: BotDto = {
  id: BOT_ID,
  name: 'Help',
  publicKey: 'pk_live_abc',
  allowedOrigins: [],
  chatCredentialId: 'c1',
  chatModel: 'mock-chat',
  embeddingCredentialId: 'c2',
  embeddingModel: 'mock-embed',
  embeddingDim: 8,
  activePromptVersionId: 'v1',
  retrievalThreshold: 0.35,
  noAnswerBehavior: 'offer_handoff',
  handoffEnabled: true,
  temperature: 0.2,
  maxOutputTokens: 600,
  monthlySpendCapUsd: null,
  requireChallenge: false,
  allowedLinkDomains: [],
  handoffPhrases: null,
  fallbackMessage: 'No answer.',
  handoffMessage: 'We will reply.',
  appearance: {
    displayName: 'Support',
    themeColor: '#2563eb',
    position: 'right',
    welcomeMessage: 'Hi! How can I help?',
    avatarUrl: null,
    privacyUrl: null,
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function asRole(role: Role, ui: React.ReactElement): React.ReactElement {
  return <WorkspaceRoleProvider role={role}>{ui}</WorkspaceRoleProvider>;
}

const botRoutes = (): Record<string, [number, unknown?]> => ({
  [`GET /api/v1/workspaces/${WS}/bots/${BOT_ID}`]: [200, BOT],
  [`GET /api/v1/workspaces/${WS}/credentials`]: [
    200,
    [
      {
        id: 'c1',
        provider: 'mock',
        label: 'Chat',
        secretLast4: null,
        baseUrl: null,
        lastUsedAt: null,
        lastErrorAt: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  ],
});

describe('buildEmbedSnippet', () => {
  it('builds the spec snippet', () => {
    expect(buildEmbedSnippet('https://support.example.com', 'pk_live_abc')).toBe(
      '<script\n  src="https://support.example.com/widget.js"\n  data-key="pk_live_abc"\n  async\n></script>',
    );
  });

  it('adds the optional attributes', () => {
    expect(
      buildEmbedSnippet('https://support.example.com/', 'pk_live_abc', {
        position: 'left',
        open: true,
        locale: 'de',
      }),
    ).toBe(
      '<script\n  src="https://support.example.com/widget.js"\n  data-key="pk_live_abc"\n  data-position="left"\n  data-open="true"\n  data-locale="de"\n  async\n></script>',
    );
  });
});

describe('BotAppearanceForm', () => {
  it('previews the label in the readable color for the theme', async () => {
    mockApi(botRoutes());
    renderWithQuery(asRole(ADMIN, <BotAppearanceForm workspaceId={WS} botId={BOT_ID} />));

    const preview = await screen.findByText(BOT.appearance.displayName);
    expect(preview).toHaveStyle({ color: contrastText(BOT.appearance.themeColor) });
  });
});

describe('BotBehaviorForm', () => {
  it('rejects an origin with a path, with the API wording', async () => {
    mockApi(botRoutes());
    renderWithQuery(asRole(ADMIN, <BotBehaviorForm workspaceId={WS} botId={BOT_ID} />));

    const origins = await screen.findByLabelText(strings.bots.origins);
    await userEvent.type(origins, 'https://shop.com/app');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    expect(await screen.findByText(strings.bots.originsPath)).toBeInTheDocument();
  });
});

describe('BotInstall', () => {
  it('warns that the widget is disabled without an allowed origin', async () => {
    mockApi(botRoutes());
    renderWithQuery(asRole(ADMIN, <BotInstall workspaceId={WS} botId={BOT_ID} />));

    expect(await screen.findByText(strings.bots.widgetDisabled)).toBeInTheDocument();
    expect(screen.getByText(/data-key="pk_live_abc"/)).toBeInTheDocument();
  });

  it('rotating the key asks for confirmation and shows the new snippet', async () => {
    const routes = botRoutes();
    routes[`POST /api/v1/workspaces/${WS}/bots/${BOT_ID}/rotate-key`] = [
      200,
      { ...BOT, publicKey: 'pk_live_new' },
    ];
    const calls = mockApi(routes);
    renderWithQuery(asRole(ADMIN, <BotInstall workspaceId={WS} botId={BOT_ID} />));

    await userEvent.click(await screen.findByRole('button', { name: strings.bots.rotate }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((call) => call.url.includes('rotate-key'))).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: strings.bots.rotate }));

    await waitFor(() => {
      expect(screen.getByText(/data-key="pk_live_new"/)).toBeInTheDocument();
    });
  });
});

describe('BotInstructions', () => {
  it('lists versions newest first and saves a new one', async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}/bots/${BOT_ID}/prompt-versions`]: [
        200,
        [
          {
            id: 'v2',
            botId: BOT_ID,
            version: 2,
            systemPrompt: 'Newest.',
            note: null,
            createdAt: '2026-01-02T00:00:00Z',
          },
          {
            id: 'v1',
            botId: BOT_ID,
            version: 1,
            systemPrompt: '',
            note: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      ],
      [`POST /api/v1/workspaces/${WS}/bots/${BOT_ID}/prompt-versions`]: [
        201,
        {
          id: 'v3',
          botId: BOT_ID,
          version: 3,
          systemPrompt: 'Even newer.',
          note: null,
          createdAt: '2026-01-03T00:00:00Z',
        },
      ],
    });
    renderWithQuery(asRole(ADMIN, <BotInstructions workspaceId={WS} botId={BOT_ID} />));

    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => within(item).getByText(/Version \d/).textContent)).toEqual([
      strings.bots.version(2),
      strings.bots.version(1),
    ]);

    await userEvent.type(screen.getByLabelText(strings.bots.instructions), 'Even newer.');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.saveVersion }));

    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && call.url.endsWith('/prompt-versions')),
      ).toBe(true);
    });
  });
});

describe('BotCreateForm', () => {
  it('offers only chat models of the chosen credential', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/credentials`]: [
        200,
        [
          {
            id: 'c1',
            provider: 'mock',
            label: 'Chat',
            secretLast4: null,
            baseUrl: null,
            lastUsedAt: null,
            lastErrorAt: null,
            lastError: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      ],
      [`GET /api/v1/workspaces/${WS}/credentials/c1/models`]: [
        200,
        [
          { id: 'mock-chat', kind: 'chat' },
          { id: 'mock-embed', kind: 'embedding' },
        ],
      ],
    });
    renderWithQuery(asRole(ADMIN, <BotCreateForm workspaceId={WS} onCreated={() => undefined} />));

    // The credential list is a query: wait for its option before selecting it.
    await screen.findByRole('option', { name: 'Chat' });
    await userEvent.selectOptions(screen.getByLabelText(strings.bots.chatCredential), 'c1');

    const model = await screen.findByLabelText(strings.bots.chatModel);
    const options = within(model)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toContain('mock-chat');
    expect(options).not.toContain('mock-embed');
  });
});

describe('BotsList', () => {
  it('shows an error instead of an empty list when the request fails', async () => {
    mockApi({ [`GET /api/v1/workspaces/${WS}/bots`]: [500, apiError('internal_error')] });

    renderWithQuery(asRole(ADMIN, <BotsList workspaceId={WS} />));

    expect(await screen.findByText(strings.app.genericError)).toBeInTheDocument();
  });
});

describe('BotGeneralForm', () => {
  it('is read-only for agents', async () => {
    mockApi(botRoutes());
    renderWithQuery(asRole(AGENT, <BotGeneralForm workspaceId={WS} botId={BOT_ID} />));

    expect(await screen.findByLabelText(strings.bots.name)).toBeDisabled();
    expect(screen.getByText(strings.bots.agentsReadOnly)).toBeInTheDocument();
  });
});
