// SPDX-License-Identifier: AGPL-3.0-only
import { APICallError, LoadAPIKeyError, NoSuchModelError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';

import { SafeFetchError } from '../common/safe-fetch';
import { ProviderError, toProviderError } from './errors';

const apiErr = (statusCode: number, responseBody = '') =>
  new APICallError({
    message: 'x',
    url: 'https://p',
    requestBodyValues: {},
    statusCode,
    responseBody,
  });

describe('toProviderError', () => {
  it.each([
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [404, 'model_not_found'],
    [429, 'rate_limited'],
    [500, 'provider_error'],
  ])('status %i → %s', (s, code) => {
    expect(toProviderError(apiErr(s)).code).toBe(code);
  });

  it('keeps the provider status', () => {
    expect(toProviderError(apiErr(429)).status).toBe(429);
  });

  it('429 with quota body → quota_exceeded', () => {
    expect(toProviderError(apiErr(429, '{"error":{"code":"insufficient_quota"}}')).code).toBe(
      'quota_exceeded',
    );
  });

  it('unwraps RetryError', () => {
    expect(
      toProviderError(
        new RetryError({ message: 'r', reason: 'maxRetriesExceeded', errors: [apiErr(401)] }),
      ).code,
    ).toBe('auth_failed');
  });

  it('maps timeouts and aborts', () => {
    expect(toProviderError(new DOMException('t', 'TimeoutError')).code).toBe('timeout');
    expect(toProviderError(new DOMException('a', 'AbortError')).code).toBe('aborted');
  });

  it.each([
    ['blocked_address', 'blocked_url'],
    ['blocked_host', 'blocked_url'],
    ['blocked_scheme', 'blocked_url'],
    ['blocked_port', 'blocked_url'],
    ['timeout', 'timeout'],
    ['dns_failed', 'connection_failed'],
    ['connection_failed', 'connection_failed'],
    ['too_large', 'provider_error'],
    ['bad_content_type', 'provider_error'],
    ['too_many_redirects', 'provider_error'],
  ] as const)('maps SafeFetchError %s → %s', (safeCode, code) => {
    expect(toProviderError(new SafeFetchError(safeCode)).code).toBe(code);
  });

  it('maps a SafeFetchError wrapped as the cause of a call error', () => {
    expect(
      toProviderError(
        new APICallError({
          message: 'fetch failed',
          url: 'https://p',
          requestBodyValues: {},
          cause: new SafeFetchError('blocked_address'),
        }),
      ).code,
    ).toBe('blocked_url');
  });

  it('maps a missing api key and an unknown model', () => {
    expect(
      toProviderError(new LoadAPIKeyError({ message: 'OPENAI_API_KEY is missing' })).code,
    ).toBe('auth_failed');
    expect(
      toProviderError(new NoSuchModelError({ modelId: 'm', modelType: 'languageModel' })).code,
    ).toBe('model_not_found');
  });

  it('passes a ProviderError through unchanged', () => {
    const err = new ProviderError('rate_limited', { status: 429 });
    expect(toProviderError(err)).toBe(err);
  });

  it('maps anything else to provider_error', () => {
    expect(toProviderError(new Error('boom')).code).toBe('provider_error');
    expect(toProviderError('nope').code).toBe('provider_error');
  });

  it('never exposes the response body', () => {
    const err = toProviderError(apiErr(500, 'sk-secret-123'));
    expect(err.safeMessage).not.toContain('sk-secret');
    expect(err.message).not.toContain('sk-secret');
    expect(JSON.stringify(err)).not.toContain('sk-secret');
    expect(err.cause).toBeUndefined();
  });
});
