// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { PARA_STYLE, emailDocument, html } from './layout';

/**
 * What `security_alert` needs: a short human explanation of what happened, e.g. that a
 * refresh token was reused and every session was signed out (spec §10.1).
 */
export const securityAlertDataSchema = z.object({
  name: z
    .string()
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
  reason: z.string().min(1).max(280),
});

export type SecurityAlertData = z.infer<typeof securityAlertDataSchema>;

export function renderSecurityAlert(data: SecurityAlertData, ctx: TemplateContext): RenderedEmail {
  return {
    subject: `Security alert for your ${ctx.productName} account`,
    text: [
      `Hi ${data.name ?? 'there'},`,
      '',
      `We noticed unusual activity on your ${ctx.productName} account:`,
      '',
      data.reason,
      '',
      'As a precaution, every active session has been signed out. If this was you, sign in again; otherwise change your password.',
    ].join('\n'),
    html: emailDocument(
      ctx,
      'Security alert',
      html`
        <p style="${PARA_STYLE}">Hi ${data.name ?? 'there'},</p>
        <p style="${PARA_STYLE}">We noticed unusual activity on your ${ctx.productName} account:</p>
        <p style="${PARA_STYLE}">${data.reason}</p>
        <p style="${PARA_STYLE}">
          As a precaution, every active session has been signed out. If this was you, sign in again;
          otherwise change your password.
        </p>
      `,
    ),
  };
}
