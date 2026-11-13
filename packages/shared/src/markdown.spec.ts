// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { parseMarkdownSubset, type MdNode } from './markdown.js';

const text = (value: string): MdNode => ({ type: 'text', text: value });
const strong = (value: string): MdNode => ({ type: 'strong', children: [text(value)] });
const emphasis = (value: string): MdNode => ({ type: 'emphasis', children: [text(value)] });
const code = (value: string): MdNode => ({ type: 'inlineCode', text: value });

const XSS_CORPUS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '[x](vbscript:msgbox(1))',
  '![i](https://evil.test/pixel.png)',
  '<a href="https://evil.test">click</a>',
  '[x](https://evil.test" onmouseover="alert(1))',
];

function links(nodes: MdNode[]): { href: string }[] {
  const found: { href: string }[] = [];
  for (const node of nodes) {
    if (node.type === 'link') found.push({ href: node.href });
    if ('children' in node) found.push(...links(node.children));
    if (node.type === 'list') for (const item of node.items) found.push(...links(item));
  }
  return found;
}

describe('parseMarkdownSubset', () => {
  it.each([
    [
      '**b** *i* `c`',
      [
        {
          type: 'paragraph',
          children: [strong('b'), text(' '), emphasis('i'), text(' '), code('c')],
        },
      ],
    ],
    [
      '<script>alert(1)</script>',
      [{ type: 'paragraph', children: [text('<script>alert(1)</script>')] }],
    ],
    ['[x](javascript:alert(1))', [{ type: 'paragraph', children: [text('x')] }]],
    ['![i](https://a/b.png)', [{ type: 'paragraph', children: [] }]],
  ])('parses %s safely', (markdown, ast) => {
    expect(parseMarkdownSubset(markdown)).toEqual(ast);
  });

  it('keeps http(s) and mailto links only when allowed', () => {
    expect(parseMarkdownSubset('[docs](https://example.com/a)')[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'link', href: 'https://example.com/a', children: [text('docs')] }],
    });
    expect(parseMarkdownSubset('[mail](mailto:hi@example.com)')[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'link', href: 'mailto:hi@example.com', children: [text('mail')] }],
    });
    expect(
      parseMarkdownSubset('[docs](https://blocked.test)', {
        isLinkAllowed: (href: string) => !href.includes('blocked'),
      })[0],
    ).toEqual({ type: 'paragraph', children: [text('docs')] });
  });

  it('parses lists, code blocks and line breaks', () => {
    const ast = parseMarkdownSubset(
      'intro\ncontinued\n\n- one\n- two\n\n1. first\n\n```ts\nconst x = 1;\n```',
    );
    expect(ast).toEqual([
      {
        type: 'paragraph',
        children: [text('intro'), { type: 'lineBreak' }, text('continued')],
      },
      {
        type: 'list',
        ordered: false,
        items: [[text('one')], [text('two')]],
      },
      { type: 'list', ordered: true, items: [[text('first')]] },
      { type: 'codeBlock', language: 'ts', text: 'const x = 1;' },
    ]);
  });

  it('survives an XSS payload corpus without producing link nodes with unsafe hrefs', () => {
    for (const payload of XSS_CORPUS) {
      const ast = parseMarkdownSubset(payload);
      for (const link of links(ast)) {
        expect(link.href).toMatch(/^(?:https?:\/\/|mailto:)/i);
      }
    }
  });
});
