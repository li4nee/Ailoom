// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, NOTE_STYLE, PARA_STYLE, emailDocument, html, siteLink } from './layout';

const agentReplyMessageSchema = z.object({
  authorName: z.string().min(1).max(200),
  content: z.string().min(1).max(4_000),
  createdAt: z.string(),
});

/** One plain-text email covering every agent reply the visitor missed while away. */
export const agentReplyDataSchema = z.object({
  workspaceId: z.uuid(),
  conversationId: z.uuid(),
  botName: z.string().min(1).max(200),
  messages: z.array(agentReplyMessageSchema).min(1).max(50),
});

export type AgentReplyData = z.infer<typeof agentReplyDataSchema>;

export function renderAgentReply(data: AgentReplyData, ctx: TemplateContext): RenderedEmail {
  const link = siteLink(
    ctx.publicUrl,
    `/w/${data.workspaceId}/conversations/${data.conversationId}`,
  );
  const replies = data.messages
    .map((message) => `${message.authorName} wrote:\n${message.content}`)
    .join('\n\n');

  return {
    subject: `New replies from ${data.botName}`,
    text: [
      `A person replied to your conversation with ${data.botName}.`,
      '',
      replies,
      '',
      `Open the conversation: ${link}`,
    ].join('\n'),
    html: emailDocument(
      ctx,
      'New replies',
      html`
        <p style="${PARA_STYLE}">
          A person replied to your conversation with <strong>${data.botName}</strong>.
        </p>
        ${data.messages
          .map(
            (message) => html`
              <p style="${PARA_STYLE}"><strong>${message.authorName} wrote:</strong></p>
              <p style="${PARA_STYLE}">${message.content}</p>
            `,
          )
          .join('')}
        <p><a href="${link}" style="${BUTTON_STYLE}">Open the conversation</a></p>
        <p style="${NOTE_STYLE}">You received this because you left this conversation.</p>
      `,
    ),
  };
}
