// SPDX-License-Identifier: AGPL-3.0-only
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

import { qualityWarnings } from './quality';
import type { ExtractResult } from './types';

/** A page whose markdown would exceed this is cut (spec §12.1 keeps one page small). */
export const DEFAULT_MAX_MARKDOWN_BYTES = 1024 * 1024;

/** Chrome that is never knowledge, whatever the article extractor decides. */
const DROP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'svg',
  'canvas',
  'form',
  'nav',
  'footer',
  'header',
  'aside',
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

/** Cookie banners, newsletters and consent walls repeat on every page of a site. */
const CHROME_CLASS = /cookie|consent|banner|newsletter|subscribe/i;

/** App roots a single-page application renders into; empty means it never ran. */
const APP_ROOTS = ['#root', '#app', '#__next', '[ng-app]'];

let turndown: TurndownService | undefined;

/**
 * Turns a page's HTML into Markdown (spec §12.3): drop the chrome, let Readability find the
 * article (falling back to the whole body), absolutize links and convert. Images, scripts and
 * non-http links never reach the result, so a chunk never contains raw HTML.
 */
export function extractHtml(
  html: string,
  pageUrl: string,
  opts: { maxMarkdownBytes?: number } = {},
): ExtractResult {
  const hasEmptyAppRoot = hasEmptyAppRootElement(html);
  const { document } = parseHTML(asDocument(html));

  removeChrome(document);
  absolutizeLinks(document, pageUrl);

  const body = document.body.innerHTML;
  const article = readArticle(document.documentElement.outerHTML);
  const title = firstNonEmpty(article?.title, document.querySelector('title')?.textContent);
  const markdown = truncate(
    htmlToMarkdown(article?.content ?? body),
    opts.maxMarkdownBytes ?? DEFAULT_MAX_MARKDOWN_BYTES,
  );

  const warnings = qualityWarnings({
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    markdown: markdown.text,
    hasEmptyAppRoot,
  });
  if (markdown.truncated) warnings.push('truncated');

  return { title: title ?? null, markdown: markdown.text, warnings };
}

/**
 * A caller may hand us an HTML fragment (`<p>…</p>`); linkedom would place it outside the
 * body, where Readability and the fallback look. Wrap anything without a body element.
 */
function asDocument(html: string): string {
  return /<body[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><head></head><body>${html}</body></html>`;
}

/** Readability on a copy, so its mutations never affect the fallback body. */
function readArticle(
  html: string,
): { title: string | null | undefined; content: string | null | undefined } | null {
  try {
    const { document } = parseHTML(html);
    return new Readability(document).parse();
  } catch {
    return null;
  }
}

function removeChrome(document: Document): void {
  for (const selector of DROP_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) element.remove();
  }
  for (const element of document.querySelectorAll('[id], [class]')) {
    const marker = `${element.id} ${element.getAttribute('class') ?? ''}`;
    if (CHROME_CLASS.test(marker)) element.remove();
  }
}

/**
 * Turndown keeps link text but cannot resolve a relative href, so resolve them first and
 * drop anything that is not http(s) or mailto (`javascript:` above all).
 */
function absolutizeLinks(document: Document, pageUrl: string): void {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')?.trim() ?? '';
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
        anchor.setAttribute('href', url.toString());
      } else {
        anchor.removeAttribute('href');
      }
    } catch {
      anchor.removeAttribute('href');
    }
  }
}

function hasEmptyAppRootElement(html: string): boolean {
  const { document } = parseHTML(asDocument(html));
  return APP_ROOTS.some((selector) => {
    const root = document.querySelector(selector);
    return root !== null && root.textContent.trim() === '';
  });
}

/** Turndown with the GFM rules and no images; also used by the DOCX extractor. */
export function htmlToMarkdown(html: string): string {
  turndown ??= createTurndown();
  return turndown
    .turndown(html)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  service.use(gfm);
  service.addRule('images', { filter: 'img', replacement: () => '' });
  service.addRule('links', {
    filter: 'a',
    replacement: (content, node) => {
      const href = node.getAttribute('href');
      if (href === null || href === '' || !/^(https?:|mailto:)/i.test(href)) return content;
      return `[${content}](${href})`;
    },
  });
  return service;
}

function truncate(markdown: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(markdown, 'utf8') <= maxBytes) return { text: markdown, truncated: false };
  // Cut on a line boundary so the last chunk does not start mid-sentence because of us.
  let text = Buffer.from(markdown, 'utf8').subarray(0, maxBytes).toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline > 0) text = text.slice(0, lastNewline);
  return { text: text.trimEnd(), truncated: true };
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed !== '') return trimmed;
  }
  return null;
}
