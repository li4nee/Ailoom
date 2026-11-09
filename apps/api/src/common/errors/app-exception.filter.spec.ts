// SPDX-License-Identifier: AGPL-3.0-only
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { AppError } from './app-error';
import { AppExceptionFilter } from './app-exception.filter';

interface Sent {
  status: number;
  body: { error: { code: string; message: string } };
}

function run(exception: unknown): Sent {
  const sent: { status: number; body: string } = { status: 0, body: '' };
  const response = {
    statusCode: 0,
    setHeader: vi.fn(),
    end(body: string) {
      sent.status = this.statusCode;
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-request-id': 'req_abcdefghijklmnopqrstu' } }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new AppExceptionFilter().catch(exception, host);
  return { status: sent.status, body: JSON.parse(sent.body) as Sent['body'] };
}

describe('AppExceptionFilter logging', () => {
  let error: MockInstance<Logger['error']>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
  });

  /** Everything passed to the logger, flattened: messages, stacks, causes. */
  const logged = (): string => error.mock.calls.flat().map(String).join('\n');

  it('logs an unknown error with its stack and keeps it out of the response', () => {
    const { status, body } = run(new Error('secret-detail'));

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-detail');
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('secret-detail');
  });

  it('logs an AppError with a 5xx status, including the stack of its cause', () => {
    const cause = new Error('connection to db lost');
    const { status, body } = run(new AppError('internal_error', { cause }));

    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('connection to db lost');
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('connection to db lost');
    expect(logged()).toContain('AppError');
  });

  it('logs an AppError raised with a custom 5xx status', () => {
    run(new AppError('conflict', { status: 503, cause: new Error('upstream down') }));

    expect(error).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('upstream down');
  });

  it('logs an HttpException with a 5xx status', () => {
    const { status } = run(new HttpException('bad gateway detail', 502));

    expect(status).toBe(502);
    expect(error).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('bad gateway detail');
  });

  it('follows a chain of causes', () => {
    const root = new Error('root-cause-marker');
    const middle = new Error('middle', { cause: root });
    run(new AppError('internal_error', { cause: middle }));

    expect(logged()).toContain('root-cause-marker');
  });

  it.each([
    ['an AppError with a 4xx status', new AppError('conflict')],
    ['a not-found AppError', new AppError('not_found')],
    ['an HttpException with a 4xx status', new HttpException('nope', 404)],
  ])('does not log %s at error level', (_label, exception) => {
    run(exception);

    expect(error).not.toHaveBeenCalled();
  });
});
