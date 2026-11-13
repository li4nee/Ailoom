// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { NOTE_STYLE, PARA_STYLE, emailDocument, html } from './layout';

/** One contact in the alert's top-5 list (spec §10.4: never an IP address). */
export const spendContactSchema = z.object({
  contact: z.string().min(1).max(320),
  conversations: z.number().int().min(0),
  costUsd: z.string(),
});

export const spendAlertDataSchema = z.object({
  botName: z.string().min(1).max(200),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  threshold: z.union([z.literal(80), z.literal(100)]),
  mtdUsd: z.string(),
  capUsd: z.string(),
  topContacts: z.array(spendContactSchema).max(5),
});

export type SpendAlertData = z.infer<typeof spendAlertDataSchema>;

function usd(value: string): string {
  return `$${value}`;
}

export function renderSpendAlert(data: SpendAlertData, ctx: TemplateContext): RenderedEmail {
  const title =
    data.threshold >= 100
      ? `${data.botName} reached its monthly spend cap`
      : `${data.botName} is at 80% of its monthly spend cap`;

  const contacts =
    data.topContacts.length === 0
      ? 'No conversations have cost anything this month yet.'
      : data.topContacts
          .map(
            (row) =>
              `${row.contact} — ${usd(row.costUsd)} across ${String(row.conversations)} conversation(s)`,
          )
          .join('\n');

  const contactItems = data.topContacts
    .map(
      (row) =>
        html`<li>
          ${row.contact} — ${usd(row.costUsd)} across ${String(row.conversations)} conversation(s)
        </li>`,
    )
    .join('');

  return {
    subject: title,
    text: [
      title,
      '',
      `Month-to-date spend: ${usd(data.mtdUsd)} of a ${usd(data.capUsd)} cap (${data.month}, UTC).`,
      data.threshold >= 100
        ? 'The bot now escalates every message instead of answering until the cap is raised or the month rolls over.'
        : 'The bot keeps answering, and will escalate every message once the cap is reached.',
      '',
      'Top contacts by cost this month:',
      contacts,
    ].join('\n'),
    html: emailDocument(
      ctx,
      title,
      html`
        <p style="${PARA_STYLE}">${title}</p>
        <p style="${PARA_STYLE}">
          Month-to-date spend: <strong>${usd(data.mtdUsd)}</strong> of a
          <strong>${usd(data.capUsd)}</strong> cap (${data.month}, UTC).
        </p>
        <p style="${PARA_STYLE}">
          ${
            data.threshold >= 100
              ? 'The bot now escalates every message instead of answering until the cap is raised or the month rolls over.'
              : 'The bot keeps answering, and will escalate every message once the cap is reached.'
          }
        </p>
        <p style="${PARA_STYLE}">Top contacts by cost this month:</p>
        <ul style="${PARA_STYLE}">
          ${contactItems}
        </ul>
        <p style="${NOTE_STYLE}">Visitor IP addresses are never stored.</p>
      `,
    ),
  };
}
