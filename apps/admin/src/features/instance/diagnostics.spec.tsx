// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { Diagnostics } from '@app/shared';

import { DiagnosticsPanel } from './components/diagnostics';

const DIAGNOSTICS: Diagnostics = {
  version: '0.1.0',
  signupMode: 'invite',
  queues: [{ name: 'knowledge.ingest', created: 2, active: 1, failed24h: 1 }],
  checks: {
    email: {
      status: 'warn',
      detail: 'Email delivery is disabled.',
      fix: 'Set EMAIL_TRANSPORT to smtp or resend and fill in its settings.',
    },
    encryption: {
      status: 'ok',
      detail: 'Encryption key v1 is active.',
      fix: null,
      keyVersions: [1],
      rowsNeedingReencrypt: 0,
    },
    storage: { status: 'ok', detail: 'The storage directory is writable.', fix: null },
    worker: {
      status: 'error',
      detail: 'The last worker heartbeat was at 2026-11-15T10:00:00.000Z.',
      fix: 'Start the worker service and check its logs.',
      lastBeatAt: '2026-11-15T10:00:00.000Z',
    },
    pgvector: { status: 'ok', detail: 'pgvector 0.8.0 is installed.', fix: null, version: '0.8.0' },
    localModel: { status: 'ok', detail: 'bge-small-en-v1.5 is ready.', fix: null },
    listen: { status: 'ok', detail: 'DATABASE_LISTEN_URL accepts connections.', fix: null },
  },
};

describe('DiagnosticsPanel', () => {
  it('renders every check with its fix', async () => {
    mockApi({ 'GET /api/health/diagnostics': [200, DIAGNOSTICS] });
    renderWithQuery(<DiagnosticsPanel isInstanceAdmin />);

    expect(await screen.findByText(strings.instance.diagnostics.title)).toBeInTheDocument();
    for (const label of Object.values(strings.instance.diagnostics.checks)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/Set EMAIL_TRANSPORT/)).toBeInTheDocument();
    expect(screen.getByText(/Start the worker service/)).toBeInTheDocument();
    expect(screen.getByText('knowledge.ingest')).toBeInTheDocument();
  });

  it('does not request diagnostics for a non-admin', () => {
    const calls = mockApi({});
    renderWithQuery(<DiagnosticsPanel isInstanceAdmin={false} />);

    expect(screen.queryByText(strings.instance.diagnostics.title)).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
