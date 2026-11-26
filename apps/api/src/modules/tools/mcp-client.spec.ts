// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../common/safe-fetch/safe-fetch', () => ({ safeFetch: safeFetchMock }));

import { AppError } from '../../common/errors';
import { callMcpTool } from './mcp-client';

function responseFor(body: string): Response {
  const message = JSON.parse(body) as { id?: number; method?: string };
  if (message.method === 'initialize') {
    return Response.json({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'test-server', version: '1.0' },
      },
    });
  }
  if (message.method === 'tools/call') {
    return Response.json({
      jsonrpc: '2.0',
      id: message.id,
      result: { structuredContent: { status: 'available' }, content: [] },
    });
  }
  return new Response(null, { status: 202 });
}

describe('MCP client boundary', () => {
  beforeEach(() => {
    safeFetchMock.mockReset();
    safeFetchMock.mockImplementation((url: URL, init: RequestInit) =>
      Promise.resolve(responseFor(typeof init.body === 'string' ? init.body : '')),
    );
  });

  it('uses one fixed origin with a redirect-free bounded policy and returns structured data only', async () => {
    await expect(
      callMcpTool(
        'https://mcp.example.test/api',
        'lookup_status',
        { region: 'eu' },
        1_000,
        { name: 'Authorization', value: 'Bearer private-token' },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'available' });

    expect(safeFetchMock).toHaveBeenCalled();
    for (const [url, init, policy] of safeFetchMock.mock.calls as [
      URL,
      RequestInit,
      { maxRedirects: number; maxBytes: number; allowedPorts: number[]; hostAllowlist: string[] },
    ][]) {
      expect(url.origin).toBe('https://mcp.example.test');
      expect(init.redirect).toBe('manual');
      expect(policy.maxRedirects).toBe(0);
      expect(policy.maxBytes).toBeLessThanOrEqual(256 * 1024);
      expect(policy.allowedPorts).toEqual([443]);
      expect(policy.hostAllowlist).toEqual(['mcp.example.test']);
    }
  });

  it('turns remote transport and protocol failures into a generic application error', async () => {
    safeFetchMock.mockRejectedValue(new Error('secret remote response body'));

    const error = await callMcpTool(
      'https://mcp.example.test/api',
      'lookup_status',
      {},
      1_000,
      null,
      new AbortController().signal,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'internal_error' });
    expect(error).not.toHaveProperty('message', 'secret remote response body');
  });

  it('rejects an endpoint containing credentials, query data, or non-HTTPS schemes', async () => {
    await expect(
      callMcpTool(
        'https://user:pass@mcp.example.test/api?token=secret',
        'lookup_status',
        {},
        1_000,
        null,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});
