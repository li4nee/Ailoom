// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { TraceDetail } from '@app/shared';

import type { Principal } from '../auth';
import { redactRemoteToolNames } from './traces.controller';

describe('redactRemoteToolNames', () => {
  const trace = {
    toolCalls: [{ name: 'mcp_lookup_status', remoteName: 'lookup_status' }],
  } as unknown as TraceDetail;

  it.each(['owner', 'admin'] as const)('shows the remote tool name to %s users', (role) => {
    const principal = { workspace: { role } } as Principal;
    expect(redactRemoteToolNames(trace, principal).toolCalls[0]?.remoteName).toBe('lookup_status');
  });

  it('hides the remote tool name from agents', () => {
    const principal = { workspace: { role: 'agent' } } as Principal;
    expect(redactRemoteToolNames(trace, principal).toolCalls[0]).toEqual({
      name: 'mcp_lookup_status',
    });
  });
});
