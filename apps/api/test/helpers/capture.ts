// SPDX-License-Identifier: AGPL-3.0-only
import type { DestinationStream } from 'pino';

import type { Mailer, MailMessage } from '../../src/modules/email';
import type { TestApp } from './app';

export class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export interface CaptureSeams {
  mailer: CapturingMailer;
  loggerDestination: DestinationStream;
  logs: string[];
}

/** Create before the app so `createTestApp` can bind the same mailer and log destination. */
export function captureSeams(): CaptureSeams {
  const logs: string[] = [];
  return {
    logs,
    mailer: new CapturingMailer(),
    loggerDestination: {
      write(chunk: string) {
        logs.push(chunk);
      },
    },
  };
}

export interface Captured {
  /** Append `response.text` for each request the test makes. */
  responses: string[];
  logs: string[];
  emails: string[];
  dbDump(): Promise<string>;
}

/** HTTP bodies, structured logs, rendered emails and every public table as JSON. */
export function captureEverything(t: TestApp, seams: CaptureSeams): Captured {
  const responses: string[] = [];
  return {
    responses,
    logs: seams.logs,
    get emails() {
      return seams.mailer.sent.flatMap((message) => [message.subject, message.text, message.html]);
    },
    async dbDump() {
      const tables = await t.ds.query<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      const rows: string[] = [];
      for (const { tablename } of tables) {
        const quoted = `"${tablename.replaceAll('"', '""')}"`;
        const dumped = await t.ds.query<{ row: unknown }[]>(
          `SELECT row_to_json(t) AS row FROM public.${quoted} t`,
        );
        rows.push(...dumped.map((row) => JSON.stringify(row.row)));
      }
      return rows.join('\n');
    },
  };
}
