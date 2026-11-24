// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, emailDocument, html, siteLink } from './layout';

export const conversationAssignedDataSchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid(),
  actorName: z.string().max(120),
});
export type ConversationAssignedData = z.infer<typeof conversationAssignedDataSchema>;

export function renderConversationAssigned(
  data: ConversationAssignedData,
  ctx: TemplateContext,
): RenderedEmail {
  const link = siteLink(
    ctx.publicUrl,
    `/w/${data.workspaceId}/conversations/${data.conversationId}`,
  );
  return {
    subject: 'A conversation was assigned to you',
    text: `${data.actorName} assigned a conversation to you.\n\nOpen the conversation: ${link}`,
    html: emailDocument(
      ctx,
      'Conversation assigned',
      html`<p>${data.actorName} assigned a conversation to you.</p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Open conversation</a></p>`,
    ),
  };
}
