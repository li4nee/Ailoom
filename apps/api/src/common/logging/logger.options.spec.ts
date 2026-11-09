// SPDX-License-Identifier: AGPL-3.0-only
import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { buildLoggerOptions } from './logger.options';

function captureLogs(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino(buildLoggerOptions({ logLevel: 'info' }), stream);
  logger.info(payload, 'redaction test');
  return lines.join('');
}

describe('buildLoggerOptions', () => {
  it('redacts credentials and never writes their values', () => {
    const line = captureLogs({
      headers: { authorization: 'Bearer top-secret-token', cookie: 'session=top-secret-cookie' },
      password: 'top-secret-password',
      apiKey: 'top-secret-api-key',
      token: 'top-secret-value',
      secret: 'top-secret-secret',
    });

    expect(line).toContain('[Redacted]');
    for (const raw of [
      'Bearer top-secret-token',
      'session=top-secret-cookie',
      'top-secret-password',
      'top-secret-api-key',
      'top-secret-value',
      'top-secret-secret',
    ]) {
      expect(line).not.toContain(raw);
    }
  });

  it('redacts set-cookie headers on responses and requests', () => {
    const line = captureLogs({
      req: { headers: { 'set-cookie': ['sid=top-secret-request-cookie'] } },
      res: {
        statusCode: 200,
        headers: { 'set-cookie': ['sid=top-secret-session; HttpOnly', 'csrf=top-secret-csrf'] },
      },
    });

    expect(line).toContain('[Redacted]');
    for (const raw of ['top-secret-request-cookie', 'top-secret-session', 'top-secret-csrf']) {
      expect(line).not.toContain(raw);
    }
    expect(line).toContain('"statusCode":200');
  });

  it('uses the configured level', () => {
    expect(buildLoggerOptions({ logLevel: 'debug' }).level).toBe('debug');
  });
});
