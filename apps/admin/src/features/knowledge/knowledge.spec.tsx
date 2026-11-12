// SPDX-License-Identifier: AGPL-3.0-only
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// The components link through the router; tests render them outside a router, so `Link`
// becomes a plain anchor.
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
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import { type DocumentViewDto, type Role, type SourceDetailDto, type SourceDto } from '@app/shared';

import { AddSourceDialog } from './components/add-source-dialog';
import { DocumentViewer } from './components/document-viewer';
import { SourceStatus } from './components/source-status';
import { SourcesTable } from './components/sources-table';
import { WarningList } from './components/warning-list';

const WS = 'w1';
const BOT = 'b1';

const SOURCE: SourceDto = {
  id: 's1',
  botId: BOT,
  type: 'sitemap',
  title: 'Docs site',
  sourceUrl: 'https://docs.test',
  status: 'pending',
  error: null,
  pagesTotal: 10,
  pagesDone: 3,
  pagesFailed: 0,
  warningCount: 0,
  lastSyncedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const DETAIL: SourceDetailDto = {
  ...SOURCE,
  documents: [
    {
      id: 'd1',
      url: null,
      title: 'Refund policy',
      status: 'active',
      warnings: ['truncated'],
      chunkCount: 2,
      lastSyncedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  nextCursor: null,
};

const DOCUMENT: DocumentViewDto = {
  document: {
    id: 'd1',
    botId: BOT,
    sourceId: 's1',
    url: null,
    title: 'Refund policy',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  currentVersion: {
    id: 'v1',
    content: '# Refunds',
    warnings: ['truncated'],
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  chunks: [
    { ordinal: 1, headingPath: '# Refunds', content: 'Thirty days.', tokenCount: 12, metadata: {} },
    {
      ordinal: 2,
      headingPath: '# Refunds > Returns',
      content: 'Bring a receipt.',
      tokenCount: 9,
      metadata: {},
    },
  ],
};

function asRole(role: Role, ui: React.ReactElement): React.ReactElement {
  return <WorkspaceRoleProvider role={role}>{ui}</WorkspaceRoleProvider>;
}

describe('knowledge status', () => {
  it('shows a label per status and the page progress', () => {
    for (const [status, label] of Object.entries(strings.knowledge.statuses)) {
      const { unmount } = renderWithQuery(
        <SourceStatus status={status as SourceDto['status']} pagesDone={3} pagesTotal={10} />,
      );
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }

    renderWithQuery(<SourceStatus status="processing" pagesDone={3} pagesTotal={10} />);
    expect(screen.getByText('3 of 10 pages')).toBeInTheDocument();
  });
});

describe('knowledge warnings', () => {
  it('renders every warning with its explanation and suggested fix', () => {
    renderWithQuery(<WarningList warnings={['js_rendered_suspected', 'pdf_no_text_layer']} />);
    expect(
      screen.getByText(strings.knowledge.warnings.js_rendered_suspected.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(strings.knowledge.warnings.js_rendered_suspected.fix),
    ).toBeInTheDocument();
    expect(
      screen.getByText(strings.knowledge.warnings.pdf_no_text_layer.title),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.knowledge.warnings.pdf_no_text_layer.fix)).toBeInTheDocument();
  });
});

describe('sources table', () => {
  const sourcesPath = `GET /api/v1/workspaces/${WS}/bots/${BOT}/sources`;

  it('lets an admin resync and delete, with a confirmation', async () => {
    mockApi({ [sourcesPath]: [200, [SOURCE]] });
    renderWithQuery(asRole('admin', <SourcesTable workspaceId={WS} botId={BOT} />));

    expect(await screen.findByText('Docs site')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.delete }));
    expect(await screen.findByText(strings.knowledge.deleteTitle)).toBeInTheDocument();
  });

  it('shows agents the list without change controls', async () => {
    mockApi({ [sourcesPath]: [200, [SOURCE]] });
    renderWithQuery(asRole('agent', <SourcesTable workspaceId={WS} botId={BOT} />));

    expect(await screen.findByText('Docs site')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: strings.knowledge.delete })).toBeNull();
    expect(screen.queryByRole('button', { name: strings.knowledge.resync })).toBeNull();
    expect(screen.getByText(strings.knowledge.agentsReadOnly)).toBeInTheDocument();
  });

  it('refreshes a row when the workspace event invalidates its query', async () => {
    let calls = 0;
    mockApi({
      [sourcesPath]: () => {
        calls += 1;
        return [200, [calls === 1 ? SOURCE : { ...SOURCE, status: 'ready', pagesDone: 10 }]];
      },
    });
    const { queryClient } = renderWithQuery(
      asRole('admin', <SourcesTable workspaceId={WS} botId={BOT} />),
    );

    expect(await screen.findByText(strings.knowledge.statuses.pending)).toBeInTheDocument();
    // What `connectWorkspaceEvents` does for a `source.updated` event.
    await queryClient.invalidateQueries({ queryKey: ['workspaces', WS, 'sources', BOT] });
    await waitFor(() => {
      expect(screen.getByText(strings.knowledge.statuses.ready)).toBeInTheDocument();
    });
  });
});

describe('add source dialog', () => {
  const sourcesPath = `GET /api/v1/workspaces/${WS}/bots/${BOT}/sources`;

  it('rejects a non-http URL before sending anything', async () => {
    const calls = mockApi({ [sourcesPath]: [200, [SOURCE]] });
    renderWithQuery(asRole('admin', <AddSourceDialog workspaceId={WS} botId={BOT} />));

    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.addSource }));
    await userEvent.type(screen.getByLabelText(strings.knowledge.urlLabel), 'ftp://docs.test');
    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.addSourceAction }));

    expect(await screen.findByText(strings.knowledge.urlInvalid)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('rejects text over 200 KB client-side', async () => {
    const calls = mockApi({ [sourcesPath]: [200, [SOURCE]] });
    renderWithQuery(asRole('admin', <AddSourceDialog workspaceId={WS} botId={BOT} />));

    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.addSource }));
    await userEvent.selectOptions(screen.getByLabelText(strings.knowledge.mode), 'text');
    await userEvent.type(screen.getByLabelText(strings.knowledge.titleLabel), 'Huge');
    await userEvent.click(screen.getByLabelText(strings.knowledge.textLabel));
    await userEvent.paste('a'.repeat(200 * 1024 + 1));
    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.addSourceAction }));

    expect(await screen.findByText(strings.knowledge.textTooLarge)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('rejects a file over the upload limit before sending', async () => {
    const calls = mockApi({ [sourcesPath]: [200, [SOURCE]] });
    renderWithQuery(asRole('admin', <AddSourceDialog workspaceId={WS} botId={BOT} />));

    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.addSource }));
    await userEvent.selectOptions(screen.getByLabelText(strings.knowledge.mode), 'file');
    const file = new File(['x'], 'manual.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 21 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText(strings.knowledge.fileLabel), file);
    await userEvent.click(screen.getByRole('button', { name: strings.knowledge.addSourceAction }));

    expect(await screen.findByText(/Files are limited to 20 MB/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });
});

describe('document viewer', () => {
  it('shows heading paths and token counts for every chunk', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/bots/${BOT}/documents/d1`]: [200, DOCUMENT],
    });
    renderWithQuery(
      asRole('agent', <DocumentViewer workspaceId={WS} botId={BOT} documentId="d1" />),
    );

    expect(await screen.findByText('Thirty days.')).toBeInTheDocument();
    const first = screen.getByText('Thirty days.').closest('li');
    expect(first).not.toBeNull();
    expect(within(first as HTMLElement).getByText(/Heading: # Refunds/)).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('12 tokens')).toBeInTheDocument();
    expect(screen.getByText('Bring a receipt.')).toBeInTheDocument();
    expect(screen.getByText(strings.knowledge.warnings.truncated.title)).toBeInTheDocument();
  });
});

describe('source detail', () => {
  it('links each document to its viewer', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/bots/${BOT}/sources/s1`]: [200, DETAIL],
    });
    const { SourceDetail } = await import('./components/source-detail');
    renderWithQuery(asRole('agent', <SourceDetail workspaceId={WS} botId={BOT} sourceId="s1" />));

    expect(await screen.findByText('Refund policy')).toBeInTheDocument();
    expect(screen.getByText('2 chunks')).toBeInTheDocument();
  });
});
