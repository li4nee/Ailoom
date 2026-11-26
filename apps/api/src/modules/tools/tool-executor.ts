// SPDX-License-Identifier: AGPL-3.0-only
import type { BotToolDto } from '@app/shared';

import { AppError } from '../../common/errors';
import { safeFetch, toolPolicy } from '../../common/safe-fetch';
import { buildToolUrl, projectToolResponse } from './tool-policy';

/** Executes a configured GET and returns only its explicitly allowed visitor-visible fields. */
export async function executeReadOnlyTool(
  tool: BotToolDto,
  arguments_: unknown,
  signal: AbortSignal,
  allowDisabled = false,
  auth: { headerName: string; token: string } | null = null,
  allowMockFixture = false,
): Promise<Record<string, unknown>> {
  if (!tool.enabled && !allowDisabled) throw new AppError('not_found');
  if (tool.mockResponse !== null) {
    if (!allowMockFixture) throw new AppError('validation_failed');
    return tool.mockResponse;
  }
  const target = buildToolUrl(tool, arguments_);
  let response: Response;
  try {
    response = await safeFetch(
      target,
      {
        method: 'GET',
        signal,
        headers: {
          accept: 'application/json',
          ...(auth === null ? {} : { [auth.headerName]: auth.token }),
        },
      },
      toolPolicy(target.hostname, tool.timeoutMs),
    );
  } catch {
    // Never surface remote host details or response text to the model or visitor.
    throw new AppError('internal_error');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError('internal_error');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppError('internal_error');
  }
  return projectToolResponse(tool, body);
}
