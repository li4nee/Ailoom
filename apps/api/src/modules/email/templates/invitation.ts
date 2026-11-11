// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { INVITATION_ROLES } from '@app/shared';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, NOTE_STYLE, PARA_STYLE, emailDocument, html, siteLink } from './layout';

/** What `invitation` needs. Ownership is never granted by invitation (spec §9.2). */
export const invitationDataSchema = z.object({
  inviterName: z.string().min(1).max(100),
  workspaceName: z.string().min(1).max(100),
  token: z.string().min(1).max(128),
  role: z.enum(INVITATION_ROLES),
});

export type InvitationData = z.infer<typeof invitationDataSchema>;

export function renderInvitation(data: InvitationData, ctx: TemplateContext): RenderedEmail {
  const link = siteLink(ctx.publicUrl, '/invitations/accept', { token: data.token });
  return {
    subject: `${data.inviterName} invited you to ${data.workspaceName} on ${ctx.productName}`,
    text: [
      `Hi,`,
      '',
      `${data.inviterName} invited you to join ${data.workspaceName} on ${ctx.productName} as ${data.role}.`,
      '',
      link,
      '',
      'The invitation expires in 7 days. You need an account to accept it.',
    ].join('\n'),
    html: emailDocument(
      ctx,
      'Workspace invitation',
      html`
        <p style="${PARA_STYLE}">Hi,</p>
        <p style="${PARA_STYLE}">
          ${data.inviterName} invited you to join ${data.workspaceName} on ${ctx.productName} as
          ${data.role}.
        </p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Accept invitation</a></p>
        <p style="${NOTE_STYLE}">
          The invitation expires in 7 days. You need an account to accept it.
        </p>
      `,
    ),
  };
}
