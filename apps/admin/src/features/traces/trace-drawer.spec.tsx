// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';

import { TraceDrawer } from './components/trace-drawer';

describe('TraceDrawer fallback details', () => {
  it('names the primary model and error when the fallback answered', async () => {
    mockApi({
      'GET /api/v1/workspaces/w1/traces/t1': [
        200,
        {
          id: 't1',
          decision: 'answered',
          decisionReason: 'answered_by_fallback',
          origin: 'widget',
          createdAt: '2026-01-01T00:00:00Z',
          promptVersion: null,
          platformPromptVersion: '2026.11.1',
          chat: { provider: 'openai', model: 'backup-model' },
          embedding: null,
          retrieval: [],
          requestSnapshot: {
            fallbackFrom: { provider: 'anthropic', model: 'primary-model', errorCode: 'timeout' },
          },
          inputTokens: 10,
          outputTokens: 5,
          embeddingTokens: 4,
          costUsd: '0.0001',
          priceKnown: true,
          latencyMs: 100,
          ttftMs: 20,
          error: null,
          feedback: null,
        },
      ],
    });
    renderWithQuery(<TraceDrawer workspaceId="w1" traceId="t1" />);

    await userEvent.click(screen.getByRole('button', { name: strings.conversations.trace.title }));

    expect(
      await screen.findByText(
        `openai/backup-model · ${strings.conversations.trace.answeredByFallback('primary-model', 'timeout')}`,
      ),
    ).toBeInTheDocument();
  });
});
