// SPDX-License-Identifier: AGPL-3.0-only
export interface EmbedSnippetOptions {
  position?: 'left' | 'right';
  /** Start the widget open (a support link can deep-link a visitor straight into a chat). */
  open?: boolean;
  locale?: string;
}

/**
 * The embed snippet (spec §16.1). One `<script>` tag, one attribute per line: it is meant to be
 * pasted into a template, where a single long line is hard to diff and hard to edit.
 */
export function buildEmbedSnippet(
  publicUrl: string,
  publicKey: string,
  opts: EmbedSnippetOptions = {},
): string {
  const base = publicUrl.replace(/\/+$/, '');
  const attributes = [`  src="${base}/widget.js"`, `  data-key="${publicKey}"`];
  if (opts.position !== undefined) attributes.push(`  data-position="${opts.position}"`);
  if (opts.open === true) attributes.push('  data-open="true"');
  if (opts.locale !== undefined) attributes.push(`  data-locale="${opts.locale}"`);
  attributes.push('  async');
  return `<script\n${attributes.join('\n')}\n></script>`;
}
