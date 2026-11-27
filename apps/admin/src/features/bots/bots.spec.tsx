// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// The behavior form links to the retrieval panel; these tests render outside a router.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  };
});

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { apiError, mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import { type BotDto, contrastText, ORIGIN_ERRORS, type Role } from '@app/shared';

import { BotAppearanceForm } from './components/bot-appearance-form';
import { BotBehaviorForm } from './components/bot-behavior-form';
import { BotCreateForm } from './components/bot-create-form';
import { BotGeneralForm } from './components/bot-general-form';
import { BotInstall } from './components/bot-install';
import { BotInstructions } from './components/bot-instructions';
import { BotModelForm } from './components/bot-model-form';
import { BotsList } from './components/bots-list';
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
  csatEnabled: true,
  fallbackChatCredentialId: null,
  fallbackChatModel: null,
  embeddingCredentialId: 'c2',
  embeddingModel: 'mock-embed',
  embeddingDim: 8,
  pendingEmbeddingModel: null,
  lastError: null,
  activePromptVersionId: 'v1',
  evalGate: null,
  retrievalThreshold: 0.35,
  retrievalMode: 'vector',
  rerankingEnabled: false,
  queryRewritingEnabled: false,
  noAnswerBehavior: 'offer_handoff',
  handoffEnabled: true,
  automaticHandoffSummaries: false,
  suggestedRepliesEnabled: false,
  agentAssistEnabled: false,
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
  [`PATCH /api/v1/workspaces/${WS}/bots/${BOT_ID}`]: [200, BOT],
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

  it('saves the conversation rating toggle', async () => {
    const calls = mockApi(botRoutes());
    renderWithQuery(asRole(ADMIN, <BotAppearanceForm workspaceId={WS} botId={BOT_ID} />));

    const toggle = await screen.findByRole('checkbox');
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    await screen.findByText(strings.bots.saved);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ csatEnabled: false });
  });
});

describe('BotModelForm', () => {
  const modelRoutes = (): Record<string, [number, unknown?]> => ({
    ...botRoutes(),
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
        {
          id: 'c2',
          provider: 'mock',
          label: 'Embed',
          secretLast4: null,
          baseUrl: null,
          lastUsedAt: null,
          lastErrorAt: null,
          lastError: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'c3',
          provider: 'mock',
          label: 'Other chat',
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
        { id: 'mock-chat-large', kind: 'chat' },
      ],
    ],
    [`GET /api/v1/workspaces/${WS}/credentials/c2/models`]: [
      200,
      [{ id: 'mock-embed', kind: 'embedding' }],
    ],
    [`GET /api/v1/workspaces/${WS}/credentials/c3/models`]: [
      200,
      [{ id: 'other-chat', kind: 'chat' }],
    ],
    [`PATCH /api/v1/workspaces/${WS}/bots/${BOT_ID}`]: [200, BOT],
  });

  it('sends only the fields that changed', async () => {
    const calls = mockApi(modelRoutes());
    renderWithQuery(asRole(ADMIN, <BotModelForm workspaceId={WS} botId={BOT_ID} />));

    const model = await screen.findByLabelText(strings.bots.chatModel);
    await screen.findByRole('option', { name: 'mock-chat-large' });
    await userEvent.selectOptions(model, 'mock-chat-large');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    await screen.findByText(strings.bots.saved);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      chatModel: 'mock-chat-large',
    });
  });

  it('requires a model after the chat credential changes', async () => {
    const calls = mockApi(modelRoutes());
    renderWithQuery(asRole(ADMIN, <BotModelForm workspaceId={WS} botId={BOT_ID} />));

    await screen.findAllByRole('option', { name: 'Other chat' });
    await userEvent.selectOptions(screen.getByLabelText(strings.bots.chatCredential), 'c3');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.bots.pickModel);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('saves a fallback and excludes the current primary model from its choices', async () => {
    const calls = mockApi(modelRoutes());
    renderWithQuery(asRole(ADMIN, <BotModelForm workspaceId={WS} botId={BOT_ID} />));

    await screen.findAllByRole('option', { name: 'Chat' });
    const fallbackCredential = await screen.findByLabelText(strings.bots.fallbackCredential);
    await userEvent.selectOptions(fallbackCredential, 'c1');
    const fallbackModel = await screen.findByLabelText(strings.bots.fallbackModel);
    expect(within(fallbackModel).queryByRole('option', { name: 'mock-chat' })).toBeNull();
    await userEvent.selectOptions(fallbackModel, 'mock-chat-large');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    await screen.findByText(strings.bots.saved);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      fallback: { chatCredentialId: 'c1', chatModel: 'mock-chat-large' },
    });
  });

  it('clears an existing fallback with null', async () => {
    const botWithFallback: BotDto = {
      ...BOT,
      fallbackChatCredentialId: 'c1',
      fallbackChatModel: 'mock-chat-large',
    };
    const routes = modelRoutes();
    routes[`GET /api/v1/workspaces/${WS}/bots/${BOT_ID}`] = [200, botWithFallback];
    const calls = mockApi(routes);
    renderWithQuery(asRole(ADMIN, <BotModelForm workspaceId={WS} botId={BOT_ID} />));

    await userEvent.click(await screen.findByRole('button', { name: strings.bots.clearFallback }));
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    await screen.findByText(strings.bots.saved);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ fallback: null });
  });

  it('shows fallback validation errors in the form alert', async () => {
    const routes = modelRoutes();
    routes[`PATCH /api/v1/workspaces/${WS}/bots/${BOT_ID}`] = [
      422,
      apiError('validation_failed', [{ path: 'fallback', message: 'Invalid fallback.' }]),
    ];
    mockApi(routes);
    renderWithQuery(asRole(ADMIN, <BotModelForm workspaceId={WS} botId={BOT_ID} />));

    await screen.findAllByRole('option', { name: 'Chat' });
    await userEvent.selectOptions(
      await screen.findByLabelText(strings.bots.fallbackCredential),
      'c1',
    );
    await userEvent.selectOptions(
      await screen.findByLabelText(strings.bots.fallbackModel),
      'mock-chat-large',
    );
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    expect(await screen.findByRole('alert')).toHaveTextContent(strings.app.genericError);
  });

  it('shows an agent the stored models without loading credentials', async () => {
    const calls = mockApi(botRoutes());
    renderWithQuery(asRole(AGENT, <BotModelForm workspaceId={WS} botId={BOT_ID} />));

    expect(await screen.findByText('mock-chat')).toBeInTheDocument();
    expect(screen.getByText('mock-embed')).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/credentials'))).toBe(false);
  });
});

describe('BotBehaviorForm', () => {
  it('lets an admin opt the bot into privacy-aware follow-up query rewriting', async () => {
    const calls = mockApi(botRoutes());
    renderWithQuery(asRole(ADMIN, <BotBehaviorForm workspaceId={WS} botId={BOT_ID} />));

    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Rewrite follow-up questions before search/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    await screen.findByText(strings.bots.saved);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      queryRewritingEnabled: true,
    });
  });

  it('rejects an origin with a path, with the API wording', async () => {
    mockApi(botRoutes());
    renderWithQuery(asRole(ADMIN, <BotBehaviorForm workspaceId={WS} botId={BOT_ID} />));

    const origins = await screen.findByLabelText(strings.bots.origins);
    await userEvent.type(origins, 'https://shop.com/app');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.save }));

    expect(await screen.findByText(ORIGIN_ERRORS.path)).toBeInTheDocument();
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
  it('marks the active version as live and saves the new version as a draft', async () => {
    const promptUrl = `/api/v1/workspaces/${WS}/bots/${BOT_ID}/prompt-versions`;
    const liveId = '00000000-0000-7000-8000-000000000001';
    const calls = mockApi({
      ...botRoutes(),
      [`GET /api/v1/workspaces/${WS}/bots/${BOT_ID}`]: [
        200,
        { ...BOT, activePromptVersionId: liveId },
      ],
      [`GET ${promptUrl}/v2/release-status`]: [
        200,
        { activeVersionId: liveId, operation: 'publish', gate: null },
      ],
      [`GET ${promptUrl}`]: [
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
            id: liveId,
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
    const [draft, live] = items;
    if (draft === undefined || live === undefined) throw new Error('Expected two prompt versions.');
    expect(within(draft).queryByText('Live')).not.toBeInTheDocument();
    expect(within(live).getByText('Live')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt comparison')).toHaveTextContent('+ Newest.');

    await userEvent.type(screen.getByLabelText(strings.bots.instructions), 'Even newer.');
    await userEvent.click(screen.getByRole('button', { name: strings.bots.saveVersion }));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST' && call.url === promptUrl)?.body).toEqual({
        systemPrompt: 'Even newer.',
        activate: false,
      });
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
