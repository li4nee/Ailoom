// SPDX-License-Identifier: AGPL-3.0-only
import { Writable } from 'node:stream';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { WorkerAppModule } from '../../app/worker-app.module';
import { loadConfig } from '../../common/config';
import { EmailService } from './email.service';
import { LogMailer } from './log.mailer';
import { MemoryMailer } from './memory.mailer';

let ds: DataSource;
let worker: INestApplicationContext;
let email: EmailService;
let mailer: MemoryMailer;

beforeAll(async () => {
  ds = await getTestDataSource();
  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    LOG_LEVEL: 'error',
  });
  mailer = new MemoryMailer();
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(config, {
      dataSource: ds,
      mailer,
      jobs: { pollingIntervalSeconds: 0.5 },
    }),
    { logger: false },
  );
  email = worker.get(EmailService);
});

afterAll(async () => {
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  mailer.sent.length = 0;
});

describe('email', () => {
  it('delivers through the job queue', async () => {
    expect(email.isEnabled()).toBe(false);

    await email.send('verify_email', 'a@b.c', { name: 'A', token: 't' });

    await vi.waitFor(
      () => {
        expect(mailer.sent).toHaveLength(1);
      },
      { timeout: 5_000 },
    );
    const sent = mailer.sent.at(0);
    expect(sent).toBeDefined();
    expect(sent!.to).toBe('a@b.c');
    expect(sent!.subject).toMatch(/verify/i);
    // The link comes from the config's PUBLIC_URL, not from the message.
    expect(sent!.text).toContain('https://support.example.com/verify-email?token=t');
  });

  it('does not send when enqueued in a rolled-back transaction', async () => {
    await ds
      .transaction(async (m) => {
        await email.send('verify_email', 'a@b.c', { name: 'A', token: 't' }, { manager: m });
        throw new Error('rollback');
      })
      .catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(mailer.sent).toHaveLength(0);
  });

  it('log mailer never logs the body at info', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: unknown, _encoding: string, callback: () => void): void {
        lines.push(String(chunk));
        callback();
      },
    });
    const logMailer = new LogMailer(pino({ level: 'info' }, stream));

    await logMailer.send({
      to: 'a@b.c',
      subject: 'Verify your email',
      text: 'body text that must not be logged',
      html: '<html>body html that must not be logged</html>',
    });

    const logged = lines.join('');
    expect(logged).toContain('a@b.c');
    expect(logged).toContain('Verify your email');
    expect(logged).not.toContain('must not be logged');
  });
});
