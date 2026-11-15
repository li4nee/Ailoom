// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, NOTE_STYLE, PARA_STYLE, emailDocument, html, siteLink } from './layout';

/** What `handoff_requested` needs; the last message is already truncated to 500 characters. */
export const handoffRequestedDataSchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid(),
  botName: z.string().min(1).max(200),
  reason: z.string().max(100).nullable(),
  contactEmail: z.string().max(254).nullable(),
  lastMessage: z.string().max(500).nullable(),
});

export type HandoffRequestedData = z.infer<typeof handoffRequestedDataSchema>;

export function renderHandoffRequested(
  data: HandoffRequestedData,
  ctx: TemplateContext,
): RenderedEmail {
  const link = siteLink(
    ctx.publicUrl,
    `/w/${data.workspaceId}/conversations/${data.conversationId}`,
  );
  const reason = data.reason ?? 'The assistant could not answer.';
  const contact = data.contactEmail ?? 'No email left';
  const message = data.lastMessage ?? 'No visitor message stored.';

  return {
    subject: `A visitor needs help with ${data.botName}`,
    text: [
      `A visitor is waiting for a person in ${data.botName}.`,
      '',
      `Reason: ${reason}`,
      `Contact: ${contact}`,
      '',
      'Last visitor message:',
      message,
      '',
      `Open the conversation: ${link}`,
    ].join('\n'),
    html: emailDocument(
      ctx,
      'A visitor needs help',
      html`
        <p style="${PARA_STYLE}">
          A visitor is waiting for a person in <strong>${data.botName}</strong>.
        </p>
        <p style="${PARA_STYLE}">Reason: ${reason}</p>
        <p style="${PARA_STYLE}">Contact: ${contact}</p>
        <p style="${PARA_STYLE}"><strong>Last visitor message</strong></p>
        <p style="${PARA_STYLE}">${message}</p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Open the conversation</a></p>
        <p style="${NOTE_STYLE}">You received this because handoff notifications are enabled.</p>
      `,
    ),
  };
}
