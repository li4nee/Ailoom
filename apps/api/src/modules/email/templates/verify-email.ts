// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, NOTE_STYLE, PARA_STYLE, emailDocument, html, siteLink } from './layout';

/** What `verify_email` needs. The token is single-use and expires (spec §9.1). */
export const verifyEmailDataSchema = z.object({
  name: z
    .string()
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
  token: z.string().min(1).max(128),
});

export type VerifyEmailData = z.infer<typeof verifyEmailDataSchema>;

export function renderVerifyEmail(data: VerifyEmailData, ctx: TemplateContext): RenderedEmail {
  const link = siteLink(ctx.publicUrl, '/verify-email', { token: data.token });
  return {
    subject: `Verify your email for ${ctx.productName}`,
    text: [
      `Hi ${data.name ?? 'there'},`,
      '',
      `Confirm your email address for ${ctx.productName}:`,
      '',
      link,
      '',
      'The link expires in 24 hours. If you did not sign up, you can ignore this email.',
    ].join('\n'),
    html: emailDocument(
      ctx,
      'Verify your email',
      html`
        <p style="${PARA_STYLE}">Hi ${data.name ?? 'there'},</p>
        <p style="${PARA_STYLE}">Confirm your email address for ${ctx.productName}:</p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Verify email</a></p>
        <p style="${NOTE_STYLE}">
          The link expires in 24 hours. If you did not sign up, you can ignore this email.
        </p>
      `,
    ),
  };
}
