// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Public } from '../../src/modules/auth';
import { createTestApp, type TestApp } from '../helpers/app';

const EchoSchema = z.object({ name: z.string() });

class EchoDto extends createZodDto(EchoSchema) {}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
    requestId: string;
  };
}

interface HttpResult {
  status: number;
  headers: Record<string, string | undefined>;
  body: unknown;
}

function requestIdOf(res: HttpResult): string {
  return String(res.headers['x-request-id']);
}

function errorOf(res: HttpResult): ErrorBody['error'] {
  return (res.body as ErrorBody).error;
}

/** Test-only routes: they exercise the filter's validation and unknown-error paths. */
@Public()
@Controller('__test')
class TestController {
  @Post('echo')
  echo(@Body() body: EchoDto): EchoDto {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret-detail');
  }
}

describe('api bootstrap', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [TestController] });
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = (await t.http.get('/api/nope')) as unknown as HttpResult;
    const error = errorOf(res);
    expect(res.status).toBe(404);
    expect(error.code).toBe('not_found');
    expect(typeof error.message).toBe('string');
    expect(error.requestId).toBe(requestIdOf(res));
  });

  it('generates a request id', async () => {
    const res = (await t.http.get('/api/health/live')) as unknown as HttpResult;
    expect(requestIdOf(res)).toMatch(/^req_[0-9A-Za-z]{20,}$/);
  });

  it('echoes a valid incoming request id', async () => {
    const res = (await t.http
      .get('/api/health/live')
      .set('X-Request-Id', 'req_abcdefghijklmnopqrstu')) as unknown as HttpResult;
    expect(requestIdOf(res)).toBe('req_abcdefghijklmnopqrstu');
  });

  it('replaces an invalid incoming request id', async () => {
    const res = (await t.http
      .get('/api/health/live')
      .set('X-Request-Id', 'x'.repeat(300))) as unknown as HttpResult;
    expect(requestIdOf(res)).not.toBe('x'.repeat(300));
  });

  it('maps zod errors to validation_failed with details', async () => {
    const res = (await t.http.post('/api/__test/echo').send({ name: 1 })) as unknown as HttpResult;
    const error = errorOf(res);
    expect(res.status).toBe(400);
    expect(error.code).toBe('validation_failed');
    expect(error.details).toHaveLength(1);
    expect(error.details?.[0]?.path).toBe('name');
    expect(typeof error.details?.[0]?.message).toBe('string');
  });

  it('maps oversized bodies to payload_too_large', async () => {
    // The JSON limit is 1 MB (a 200 KB text source must fit), so overshoot it.
    const res = (await t.http
      .post('/api/__test/echo')
      .send({ name: 'x'.repeat(2_000_000) })) as unknown as HttpResult;
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe('payload_too_large');
  });

  it('hides internals of unknown errors', async () => {
    const res = (await t.http.get('/api/__test/boom')) as unknown as HttpResult;
    expect(res.status).toBe(500);
    expect(errorOf(res).code).toBe('internal_error');
    expect(JSON.stringify(res.body)).not.toContain('secret-detail');
  });

  it('serves liveness', async () => {
    const res = (await t.http.get('/api/health/live')) as unknown as HttpResult;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
