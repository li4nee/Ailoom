// SPDX-License-Identifier: AGPL-3.0-only
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
  type Tool,
} from '@modelcontextprotocol/client';

import { AppError } from '../../common/errors';
import { mcpPolicy } from '../../common/safe-fetch/policies';
import { safeFetch } from '../../common/safe-fetch/safe-fetch';

export interface McpAuthHeader {
  name: string;
  value: string;
}

/** Discover remote declarations in an admin-only operation. They remain untrusted until reviewed. */
export async function discoverMcpTools(
  endpoint: string,
  timeoutMs: number,
  auth: McpAuthHeader | null,
): Promise<Tool[]> {
  return withClient(endpoint, timeoutMs, auth, async (client, signal) => {
    const result = await client.listTools(undefined, {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    });
    return result.tools;
  });
}

/** Call one explicitly selected remote tool. Text and resource content are never returned. */
export async function callMcpTool(
  endpoint: string,
  toolName: string,
  arguments_: Record<string, unknown>,
  timeoutMs: number,
  auth: McpAuthHeader | null,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  return withClient(
    endpoint,
    timeoutMs,
    auth,
    async (client, operationSignal) => {
      const result = await client.callTool(
        { name: toolName, arguments: arguments_ },
        { signal: operationSignal, timeout: timeoutMs, maxTotalTimeout: timeoutMs },
      );
      if (result.isError === true) throw new AppError('internal_error');
      const structured = result.structuredContent;
      if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) {
        throw new AppError('internal_error');
      }
      return structured as Record<string, unknown>;
    },
    signal,
  );
}

async function withClient<T>(
  endpoint: string,
  timeoutMs: number,
  auth: McpAuthHeader | null,
  run: (client: Client, signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const url = parseEndpoint(endpoint);
  const origin = url.origin;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);
  const headers = auth === null ? {} : { [auth.name]: auth.value };
  const safeMcpFetch: FetchLike = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    let target: URL;
    try {
      target = new URL(requestUrl, origin);
    } catch {
      throw new AppError('internal_error');
    }
    if (target.origin !== origin) throw new AppError('internal_error');
    try {
      const { signal: requestSignal, ...requestInit } = init ?? {};
      const requestSignals = [
        signal,
        ...(requestSignal === null || requestSignal === undefined ? [] : [requestSignal]),
      ];
      return await safeFetch(
        target,
        {
          ...requestInit,
          signal: AbortSignal.any(requestSignals),
          redirect: 'manual',
        },
        mcpPolicy(target.hostname, timeoutMs),
      );
    } catch {
      if (callerSignal?.aborted === true) throw callerSignal.reason;
      if (timeoutSignal.aborted) throw new AppError('internal_error');
      // No remote URL, response body, header, or SDK error text crosses this boundary.
      throw new AppError('internal_error');
    }
  };
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: safeMcpFetch,
    requestInit: { headers, redirect: 'manual' },
    redirectPolicy: 'same-origin',
    onInsufficientScope: 'throw',
  });
  const client = new Client({ name: 'AiLoom', version: '1.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport, {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    });
    return await run(client, signal);
  } catch (error) {
    if (callerSignal?.aborted === true) throw callerSignal.reason;
    if (error instanceof AppError) throw error;
    throw new AppError('internal_error');
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

function parseEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AppError('validation_failed');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.port !== ''
  ) {
    throw new AppError('validation_failed');
  }
  return url;
}
