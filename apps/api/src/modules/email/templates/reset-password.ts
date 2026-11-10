// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, NOTE_STYLE, PARA_STYLE, emailDocument, html, siteLink } from './layout';

/** What `reset_password` needs. The token is single-use and expires (spec §9.1). */
export const resetPasswordDataSchema = z.object({
  name: z
    .string()
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
  token: z.string().min(1).max(128),
});

export type ResetPasswordData = z.infer<typeof resetPasswordDataSchema>;

export function renderResetPassword(data: ResetPasswordData, ctx: TemplateContext): RenderedEmail {
  const link = siteLink(ctx.publicUrl, '/reset-password', { token: data.token });
  return {
    subject: `Reset your ${ctx.productName} password`,
    text: [
      `Hi ${data.name ?? 'there'},`,
      '',
      'Someone asked to reset the password for your account.',
      '',
      link,
      '',
      'The link expires in one hour. If this was not you, you can ignore this email and your password will keep working.',
    ].join('\n'),
    html: emailDocument(
      ctx,
      'Reset your password',
      html`
        <p style="${PARA_STYLE}">Hi ${data.name ?? 'there'},</p>
        <p style="${PARA_STYLE}">Someone asked to reset the password for your account.</p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Choose a new password</a></p>
        <p style="${NOTE_STYLE}">
          The link expires in one hour. If this was not you, you can ignore this email and your
          password will keep working.
        </p>
      `,
    ),
  };
}
