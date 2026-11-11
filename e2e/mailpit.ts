// SPDX-License-Identifier: AGPL-3.0-only
import { expect } from '@playwright/test';

import { MAILPIT_URL } from './stack';

export interface ReceivedEmail {
  subject: string;
  text: string;
}

interface SearchResult {
  messages: { ID: string; Subject: string }[];
}

interface Message {
  Subject: string;
  Text: string;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${String(response.status)}`);
  return (await response.json()) as T;
}

/** Reads Mailpit's API. Mail is sent by the worker, so lookups poll until a message arrives. */
export const mailpit = {
  async lastEmailTo(address: string, subject?: RegExp): Promise<ReceivedEmail> {
    let found: { ID: string } | undefined;
    await expect
      .poll(
        async () => {
          const query = encodeURIComponent(`to:"${address}"`);
          const result = await getJson<SearchResult>(`/api/v1/search?query=${query}`);
          found = result.messages.find((m) => subject === undefined || subject.test(m.Subject));
          return found !== undefined;
        },
        { timeout: 30_000, message: `an email to ${address}` },
      )
      .toBe(true);
    if (found === undefined) throw new Error(`no email to ${address}`);
    const message = await getJson<Message>(`/api/v1/message/${found.ID}`);
    return { subject: message.Subject, text: message.Text };
  },
};

/** The first link in `text` whose path is `path`, e.g. `/verify-email`. */
export function extractLink(text: string, path: string): string {
  for (const match of text.matchAll(/https?:\/\/[^\s<>")\]]+/g)) {
    const url = new URL(match[0]);
    if (url.pathname === path) return url.toString();
  }
  throw new Error(`no ${path} link in:\n${text}`);
}
