// SPDX-License-Identifier: AGPL-3.0-only

/** Invisible characters (zero-width space/joiners, BOM, soft hyphen) carry no meaning. */
const ZERO_WIDTH = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/** A fence line opens or closes a code block; fence styles are ``` and ~~~. */
const FENCE = /^ {0,3}(?:```|~~~)/;

/** A line that repeats by design: headings, list items, table rows, quotes. */
const STRUCTURAL = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/;

/** A boilerplate line is short and plain; longer repeats are content, not chrome. */
const BOILERPLATE_MAX_LENGTH = 120;
const BOILERPLATE_MIN_COUNT = 3;

interface Line {
  text: string;
  /** Whether removing a repeated copy of this line is safe. */
  candidate: boolean;
  /** Blank lines inside a fence are content and must not be collapsed. */
  inFence: boolean;
}

/**
 * Normalizes extracted content so the same page ingested twice hashes the same
 * (spec §12.2): NFC, no zero-width characters, `\n` line endings, one blank line at most,
 * no trailing spaces outside code fences, and footer/nav lines that repeat three or more
 * times reduced to their first occurrence. Code fences are left byte-for-byte.
 */
export function normalizeMarkdown(markdown: string): string {
  const lines = markdown.replace(ZERO_WIDTH, '').normalize('NFC').replace(/\r\n?/g, '\n');
  const cleaned = cleanLines(lines.split('\n'));
  const collapsed = collapseBlankLines(cleaned);
  const deduped = dropRepeatedBoilerplate(collapsed);

  const texts = deduped.map((line) => line.text);
  while (texts[0] === '') texts.shift();
  while (texts.at(-1) === '') texts.pop();
  return texts.join('\n');
}

/** Trims trailing spaces outside fences and marks each line as boilerplate-eligible. */
function cleanLines(lines: readonly string[]): Line[] {
  let inFence = false;
  return lines.map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return { text: line.trimEnd(), candidate: false, inFence };
    }
    if (inFence) return { text: line, candidate: false, inFence };
    const text = line.replace(/[ \t]+$/, '');
    const candidate =
      text !== '' && text.length <= BOILERPLATE_MAX_LENGTH && !STRUCTURAL.test(text);
    return { text, candidate, inFence };
  });
}

/** Two or more blank lines become one; a blank line inside a fence is content. */
function collapseBlankLines(lines: readonly Line[]): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    const previous = out.at(-1);
    if (line.text === '' && previous?.text === '' && !line.inFence) continue;
    out.push(line);
  }
  return out;
}

/**
 * "Skip to content", "© 2026 Acme", "Accept all cookies": every page of a site repeats them.
 * Keep the first copy so a single-page source is unchanged.
 */
function dropRepeatedBoilerplate(lines: readonly Line[]): Line[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.candidate) continue;
    counts.set(line.text, (counts.get(line.text) ?? 0) + 1);
  }

  const kept = new Set<string>();
  return lines.filter((line) => {
    if (!line.candidate) return true;
    if ((counts.get(line.text) ?? 0) < BOILERPLATE_MIN_COUNT) return true;
    if (kept.has(line.text)) return false;
    kept.add(line.text);
    return true;
  });
}
