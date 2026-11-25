// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import type { RenderedEmail, TemplateContext } from './layout';
import { BUTTON_STYLE, emailDocument, html, siteLink } from './layout';

export const suggestionDataSchema = z.object({
  workspaceId: z.uuid(),
  suggestionId: z.uuid(),
  status: z.enum(['created', 'approved', 'rejected']),
});
export type SuggestionData = z.infer<typeof suggestionDataSchema>;

export function renderSuggestion(data: SuggestionData, ctx: TemplateContext): RenderedEmail {
  const link = siteLink(ctx.publicUrl, `/w/${data.workspaceId}/knowledge/suggestions`);
  const text =
    data.status === 'created'
      ? 'A correction needs review.'
      : `Your correction was ${data.status}.`;
  return {
    subject:
      data.status === 'created'
        ? 'A knowledge correction needs review'
        : `Your correction was ${data.status}`,
    text: `${text}\n\nReview suggestions: ${link}`,
    html: emailDocument(
      ctx,
      'Knowledge correction',
      html`<p>${text}</p>
        <p><a href="${link}" style="${BUTTON_STYLE}">Review suggestions</a></p>`,
    ),
  };
}
