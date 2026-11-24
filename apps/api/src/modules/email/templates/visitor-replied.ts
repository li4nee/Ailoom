// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, emailDocument, html, siteLink } from './layout';

export const visitorRepliedDataSchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid(),
  preview: z.string().max(140).nullable(),
});
export type VisitorRepliedData = z.infer<typeof visitorRepliedDataSchema>;

export function renderVisitorReplied(
  data: VisitorRepliedData,
  ctx: TemplateContext,
): RenderedEmail {
  const link = siteLink(
    ctx.publicUrl,
    `/w/${data.workspaceId}/conversations/${data.conversationId}`,
  );
  return {
    subject: 'A visitor replied',
    text: `A visitor replied in a conversation assigned to you.${data.preview ? `\n\n${data.preview}` : ''}\n\nOpen the conversation: ${link}`,
    html: emailDocument(
      ctx,
      'A visitor replied',
      html`<p>A visitor replied in a conversation assigned to you.</p>
        <p>${data.preview ?? ''}</p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Open conversation</a></p>`,
    ),
  };
}
