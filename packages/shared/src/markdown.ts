// SPDX-License-Identifier: MIT
/**
 * The strict Markdown subset from spec §16.2: paragraphs, bold, italic, lists, inline code,
 * code blocks and http(s)/mailto links. There is no HTML, image or heading node, so neither
 * model output nor retrieved sources can smuggle markup into the page.
 */
export type MdNode =
  | { type: 'paragraph'; children: MdNode[] }
  | { type: 'strong'; children: MdNode[] }
  | { type: 'emphasis'; children: MdNode[] }
  | { type: 'inlineCode'; text: string }
  | { type: 'codeBlock'; language: string | null; text: string }
  | { type: 'list'; ordered: boolean; items: MdNode[][] }
  | { type: 'link'; href: string; children: MdNode[] }
  | { type: 'text'; text: string }
  | { type: 'lineBreak' };

export interface ParseMarkdownOptions {
  /** Additional allow-list check applied after the http(s)/mailto scheme check. */
  isLinkAllowed?: (href: string) => boolean;
}

const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i;
const FENCE = /^```(\S*)\s*$/;
const UNORDERED = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;

export function parseMarkdownSubset(markdown: string, opts: ParseMarkdownOptions = {}): MdNode[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ?? '';
      blocks.push({
        type: 'codeBlock',
        language: language === '' ? null : language,
        text: body.join('\n'),
      });
      continue;
    }

    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const items: MdNode[][] = [];
      while (index < lines.length) {
        const item = lines[index] ?? '';
        const match = ordered ? ORDERED.exec(item) : UNORDERED.exec(item);
        if (match === null) break;
        items.push(parseInline(item.slice(match[0].length), opts));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        current.trim() === '' ||
        FENCE.test(current) ||
        UNORDERED.test(current) ||
        ORDERED.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }

    const children: MdNode[] = [];
    for (const [lineIndex, text] of paragraph.entries()) {
      if (lineIndex > 0) children.push({ type: 'lineBreak' });
      children.push(...parseInline(text, opts));
    }
    blocks.push({ type: 'paragraph', children });
  }

  return blocks;
}

function parseInline(text: string, opts: ParseMarkdownOptions): MdNode[] {
  const nodes: MdNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer !== '') {
      nodes.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);

    // Images are removed entirely: a remote image URL would leak the visitor's IP and
    // reading context to whoever controls it.
    const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest);
    if (image !== null) {
      index += image[0].length;
      continue;
    }

    const link = /^\[([^\]]+)\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/.exec(rest);
    if (link !== null) {
      flush();
      const children = parseInline(link[1] ?? '', opts);
      const href = link[2] ?? '';
      const allowed =
        SAFE_HREF.test(href) && (opts.isLinkAllowed === undefined || opts.isLinkAllowed(href));
      if (allowed) nodes.push({ type: 'link', href, children });
      else nodes.push(...children);
      index += link[0].length;
      continue;
    }

    if (rest.startsWith('`')) {
      const end = text.indexOf('`', index + 1);
      if (end !== -1) {
        flush();
        nodes.push({ type: 'inlineCode', text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith('**')) {
      const end = text.indexOf('**', index + 2);
      if (end !== -1) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(text.slice(index + 2, end), opts) });
        index = end + 2;
        continue;
      }
    }

    const marker = rest[0];
    if (marker === '*' || marker === '_') {
      const end = text.indexOf(marker, index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ type: 'emphasis', children: parseInline(text.slice(index + 1, end), opts) });
        index = end + 1;
        continue;
      }
    }

    buffer += rest.charAt(0);
    index += 1;
  }

  flush();
  return nodes;
}
