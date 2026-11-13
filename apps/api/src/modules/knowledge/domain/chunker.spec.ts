// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { chunkMarkdown, type ChunkDraft } from './chunker';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const longDoc = `## Billing\n\n${Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${String(index)} ` + 'word '.repeat(60),
).join('\n\n')}`;

function contents(chunks: ChunkDraft[]): string[] {
  return chunks.map((chunk) => chunk.content);
}

describe('chunkMarkdown', () => {
  it('builds heading paths', () => {
    const chunks = chunkMarkdown({ title: 'T', markdown: '# Billing\n## Refunds\nText.' });

    expect(chunks[0]?.headingPath).toBe('Billing > Refunds');
  });

  it('never exceeds maxTokens', () => {
    const chunks = chunkMarkdown({ title: 'T', markdown: longDoc });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(700);
  });

  it('targets ~400 tokens', () => {
    const chunks = chunkMarkdown({ title: 'T', markdown: longDoc });

    expect(median(chunks.map((chunk) => chunk.tokenCount))).toBeGreaterThan(250);
  });

  it('overlaps within a section only', () => {
    const markdown = `# A\n\n${'alpha '.repeat(3000)}\n\n# B\n\nbeta beta beta.`;
    const chunks = chunkMarkdown({ title: 'T', markdown });

    const aChunks = chunks.filter((chunk) => chunk.headingPath === 'A');
    expect(aChunks.length).toBeGreaterThan(1);
    const firstTail = (aChunks[0]?.content ?? '').split(/(?<=\.)\s+/).slice(-1)[0] ?? '';
    expect(firstTail.length).toBeGreaterThan(0);
    expect(aChunks[1]?.content).toContain('alpha');

    const bChunks = chunks.filter((chunk) => chunk.headingPath === 'B');
    expect(bChunks).toHaveLength(1);
    expect(bChunks[0]?.content).not.toContain('alpha');
  });

  it('keeps a small code block and table whole', () => {
    const code = '```\nconst a = 1;\nconst b = 2;\n```';
    const table = '| Plan | Price |\n| --- | --- |\n| Standard | Free |';
    const chunks = chunkMarkdown({ title: 'T', markdown: `# A\n\n${code}\n\n${table}` });

    expect(contents(chunks).some((content) => content.includes(code))).toBe(true);
    expect(contents(chunks).some((content) => content.includes(table))).toBe(true);
  });

  it('records PDF pages and strips page breaks', () => {
    const chunks = chunkMarkdown({ title: 'T', markdown: 'p1 text\n\f\np2 text' });

    expect(chunks[0]?.metadata.pages).toEqual([1, 2]);
    expect(chunks[0]?.content).not.toContain('\f');
  });

  it('prepends title and heading path only to embedText', () => {
    const chunks = chunkMarkdown({ title: 'Refunds', markdown: '# Billing\n\nText here.' });

    expect(chunks[0]?.content).toBe('Text here.');
    expect(chunks[0]?.embedText).toBe('Refunds\nBilling\n\nText here.');
  });

  it('numbers chunks from zero in document order', () => {
    const chunks = chunkMarkdown({ title: 'T', markdown: longDoc });

    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
  });

  it('returns [] for empty input', () => {
    expect(chunkMarkdown({ title: 'T', markdown: '   ' })).toEqual([]);
  });

  it('is deterministic', () => {
    const doc = { title: 'T', markdown: longDoc };

    expect(chunkMarkdown(doc)).toEqual(chunkMarkdown(doc));
  });
});
