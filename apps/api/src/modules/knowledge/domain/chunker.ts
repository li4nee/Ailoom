// SPDX-License-Identifier: AGPL-3.0-only
import { countTokens, splitByTokens } from './tokens';

/** Spec §12.4: aim for 400 tokens, never send more than 700, carry 60 of overlap. */
export const CHUNK_TARGET_TOKENS = 400;
export const CHUNK_MAX_TOKENS = 700;
export const CHUNK_OVERLAP_TOKENS = 60;

/** A form feed on its own line separates two PDF pages (see `extract/pdf.ts`). */
const PAGE_BREAK = '\f';

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE = /^\s{0,3}(?:```|~~~)/;

export interface ChunkOptions {
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
}

export interface ChunkMetadata {
  /** 1-based PDF pages this chunk's text came from; absent when the source has no pages. */
  pages?: number[];
}

export interface ChunkDraft {
  ordinal: number;
  headingPath: string;
  content: string;
  tokenCount: number;
  embedText: string;
  metadata: ChunkMetadata;
}

interface Block {
  text: string;
  pages: number[];
}

interface Section {
  headingPath: string;
  blocks: Block[];
}

/**
 * Splits a document into embeddable chunks (spec §12.4), keeping its structure: a chunk never
 * spans a section, headings become the `headingPath` that is prepended to the embedded text,
 * and a small code block or table is never cut. Overlap is carried inside a section only, so
 * a chunk never mixes text from two unrelated headings.
 */
export function chunkMarkdown(
  doc: { title: string; markdown: string },
  opts: ChunkOptions = {},
): ChunkDraft[] {
  const target = opts.targetTokens ?? CHUNK_TARGET_TOKENS;
  const max = opts.maxTokens ?? CHUNK_MAX_TOKENS;
  const overlap = opts.overlapTokens ?? CHUNK_OVERLAP_TOKENS;

  const drafts: ChunkDraft[] = [];
  for (const section of parseSections(doc.markdown)) {
    const pieces = packSection(section, { target, max, overlap });
    for (const piece of pieces) {
      drafts.push({
        ordinal: drafts.length,
        headingPath: section.headingPath,
        content: piece.content,
        tokenCount: countTokens(piece.content),
        embedText: `${doc.title}\n${section.headingPath}\n\n${piece.content}`,
        metadata: piece.pages.length === 0 ? {} : { pages: piece.pages },
      });
    }
  }
  return drafts;
}

/** Splits at ATX headings (outside code fences) and tracks PDF pages across page breaks. */
function parseSections(markdown: string): Section[] {
  // Text before the first heading is still a section (with an empty heading path).
  const sections: Section[] = [];
  const headings: { level: number; text: string }[] = [];
  let current: Section = { headingPath: '', blocks: [] };
  sections.push(current);
  let block: string[] = [];
  let pages: number[] = [];
  let page = 1;
  let inFence = false;

  const flush = (): void => {
    const text = block.join('\n').trim();
    if (text !== '') current.blocks.push({ text, pages });
    block = [];
    pages = [];
  };

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    // The form feed is whitespace, so it is recognised before the blank-line check.
    if (line.includes(PAGE_BREAK)) {
      page += 1;
      continue;
    }
    if (FENCE.test(line)) {
      inFence = !inFence;
      block.push(line);
      if (!pages.includes(page)) pages.push(page);
      continue;
    }
    if (!inFence) {
      const heading = HEADING.exec(line);
      if (heading !== null) {
        flush();
        const level = heading[1]?.length ?? 1;
        while ((headings.at(-1)?.level ?? 0) >= level) headings.pop();
        headings.push({ level, text: heading[2] ?? '' });
        current = { headingPath: headings.map((entry) => entry.text).join(' > '), blocks: [] };
        sections.push(current);
        continue;
      }
      if (line.trim() === '') {
        flush();
        continue;
      }
    }
    block.push(line);
    if (!pages.includes(page)) pages.push(page);
  }
  flush();

  return sections.filter((section) => section.blocks.length > 0);
}

function packSection(
  section: Section,
  opts: { target: number; max: number; overlap: number },
): { content: string; pages: number[] }[] {
  const packed: { content: string; pages: number[] }[] = [];
  let text = '';
  let pages: number[] = [];

  const flush = (): void => {
    if (text.trim() !== '') packed.push({ content: text.trim(), pages });
    text = '';
    pages = [];
  };

  for (const block of section.blocks) {
    for (const piece of splitBlock(block, opts.max)) {
      const candidate = text === '' ? piece.text : `${text}\n\n${piece.text}`;
      if (text !== '' && countTokens(candidate) > opts.target) {
        flush();
        text = piece.text;
        pages = [...piece.pages];
      } else {
        text = candidate;
        for (const page of piece.pages) if (!pages.includes(page)) pages.push(page);
      }
    }
  }
  flush();

  addOverlap(packed, opts);
  return packed;
}

/** A block that fits maxTokens is one unit; a longer one is split by sentence, then tokens. */
function splitBlock(block: Block, max: number): Block[] {
  if (countTokens(block.text) <= max) return [block];

  const pieces: string[] = [];
  let current = '';
  for (const sentence of splitSentences(block.text)) {
    const parts = countTokens(sentence) > max ? splitByTokens(sentence, max) : [sentence];
    for (const part of parts) {
      const candidate = current === '' ? part : `${current} ${part}`;
      if (current !== '' && countTokens(candidate) > max) {
        pieces.push(current.trim());
        current = part;
      } else {
        current = candidate;
      }
    }
  }
  if (current.trim() !== '') pieces.push(current.trim());

  return pieces.map((text) => ({ text, pages: block.pages }));
}

/**
 * Prepend the tail of the previous chunk — whole sentences up to `overlap` tokens — so a
 * sentence cut at a chunk boundary is still findable. Never across sections, and never so
 * much that the result would exceed `max`.
 */
function addOverlap(
  chunks: { content: string; pages: number[] }[],
  opts: { max: number; overlap: number },
): void {
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1];
    const chunk = chunks[index];
    if (previous === undefined || chunk === undefined) continue;

    const tail: string[] = [];
    let tokens = 0;
    for (const sentence of splitSentences(previous.content).reverse()) {
      const count = countTokens(sentence);
      if (tokens + count > opts.overlap) break;
      tail.unshift(sentence);
      tokens += count;
    }
    while (tail.length > 0) {
      const content = `${tail.join(' ')}\n\n${chunk.content}`;
      if (countTokens(content) <= opts.max) {
        chunk.content = content;
        break;
      }
      tail.shift();
    }
  }
}

const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'sentence' })
    : null;

function splitSentences(text: string): string[] {
  if (segmenter === null) {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence !== '');
  }
  return [...segmenter.segment(text)]
    .map((segment) => segment.segment.trim())
    .filter((sentence) => sentence !== '');
}
