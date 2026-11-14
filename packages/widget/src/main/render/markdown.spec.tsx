// SPDX-License-Identifier: MIT
import { render, type ComponentChild } from 'preact';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Citation } from '@app/shared';

import { Citations, isLinkAllowedFor } from './citations';
import { Markdown } from './markdown';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
});

function draw(node: ComponentChild): HTMLElement {
  render(node, container);
  return container;
}

describe('Markdown', () => {
  it('renders an XSS corpus as text, never as markup', () => {
    const corpus = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '<a href="javascript:alert(1)">x</a>',
    ].join('\n\n');

    const dom = draw(<Markdown source={corpus} />);

    expect(dom.querySelector('script')).toBeNull();
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.querySelector('[onerror]')).toBeNull();
    expect(dom.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(dom.textContent).toContain('<script>alert(1)</script>');
  });

  it('adds target and rel to allowed links', () => {
    const dom = draw(<Markdown source="See [the docs](https://example.com/docs)." />);

    const link = dom.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('demotes a link the caller disallows to its text', () => {
    const dom = draw(
      <Markdown source="[elsewhere](https://evil.test/x)" isLinkAllowed={() => false} />,
    );

    expect(dom.querySelector('a')).toBeNull();
    expect(dom.textContent).toContain('elsewhere');
  });

  it('renders unclosed markdown as text without throwing', () => {
    const dom = draw(<Markdown source={'**unclosed and `code'} />);

    expect(dom.textContent).toContain('**unclosed');
  });
});

describe('Citations', () => {
  const citation = (overrides: Partial<Citation>): Citation => ({
    n: 1,
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    title: 'Refunds',
    url: 'https://shop.com/refunds',
    ...overrides,
  });

  it('links HTTP sources and shows file sources as plain titles', () => {
    const dom = draw(
      <Citations
        items={[
          citation({ n: 1 }),
          citation({ n: 2, chunkId: 'chunk-2', title: 'policy.pdf', url: null }),
        ]}
      />,
    );

    const links = dom.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://shop.com/refunds');
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(dom.textContent).toContain('policy.pdf');
    expect(dom.querySelectorAll('li')).toHaveLength(2);
  });

  it('allows only cited hosts and configured extra domains', () => {
    const allowed = isLinkAllowedFor([citation({})], ['docs.example.com']);

    expect(allowed('https://shop.com/refunds')).toBe(true);
    expect(allowed('https://docs.example.com/a')).toBe(true);
    expect(allowed('https://evil.test/x')).toBe(false);
    expect(allowed('javascript:alert(1)')).toBe(false);
  });
});
