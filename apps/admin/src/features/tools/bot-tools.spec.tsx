// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WorkspaceRoleProvider } from '@/components/role-gate';
import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type { Role } from '@app/shared';

import { BotTools } from './components/bot-tools';

const ADMIN: Role = 'admin';
const WS = '0193b502-331d-7b12-8af4-6322e278e3f1';
const BOT = '0193b502-331d-7b12-8af4-6322e278e3f2';

describe('BotTools MCP setup', () => {
  it('discovers a remote tool but still requires explicit schema and read-only review', async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}/bots/${BOT}/tools`]: [200, []],
      [`POST /api/v1/workspaces/${WS}/bots/${BOT}/tools/mcp/discover`]: [
        200,
        {
          tools: [
            {
              name: 'lookup_status',
              description: 'Read public service status.',
              inputs: [
                {
                  name: 'region',
                  description: 'Region to check.',
                  type: 'string',
                  required: true,
                  maxLength: 40,
                },
              ],
              readOnlyHint: true,
            },
          ],
          unsupportedCount: 1,
        },
      ],
    });
    renderWithQuery(
      <WorkspaceRoleProvider role={ADMIN}>
        <BotTools workspaceId={WS} botId={BOT} />
      </WorkspaceRoleProvider>,
    );

    await userEvent.selectOptions(await screen.findByLabelText(strings.tools.transport), 'mcp');
    await userEvent.type(
      screen.getByLabelText(strings.tools.endpoint),
      'https://mcp.example.test/api',
    );
    await userEvent.click(screen.getByRole('button', { name: strings.tools.discover }));

    const remoteTool = await screen.findByRole('button', { name: /lookup_status/ });
    expect(screen.getByText(strings.tools.unsupportedTools(1))).toBeInTheDocument();
    await userEvent.click(remoteTool);

    expect(screen.getByLabelText(strings.tools.remoteTool)).toHaveValue('lookup_status');
    expect(screen.getByLabelText(strings.tools.reviewSchema)).not.toBeChecked();
    expect(screen.getByLabelText(strings.tools.approveReadOnly)).not.toBeChecked();
    expect(calls[1]?.body).toMatchObject({ endpoint: 'https://mcp.example.test/api' });
  });
});
