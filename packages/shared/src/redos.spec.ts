// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { parseCitations } from './citations.js';
import { applyLinkPolicy } from './link-policy.js';

/** Adversarial model output must be processed in linear time; quadratic regexes take seconds. */
const BUDGET_MS = 250;
const N = 50_000;

function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('regex safety on adversarial model output', () => {
  it('handles a long unclosed link target in linear time', () => {
    const input = `[label](${'a'.repeat(N)}`;
    expect(timed(() => applyLinkPolicy(input, () => false))).toBeLessThan(BUDGET_MS);
  });

  it('handles a long unclosed image target in linear time', () => {
    const input = `![alt](${'a'.repeat(N)}`;
    expect(timed(() => applyLinkPolicy(input, () => false))).toBeLessThan(BUDGET_MS);
  });

  it('handles many repeated image openers in linear time', () => {
    const input = '!['.repeat(N);
    expect(timed(() => applyLinkPolicy(input, () => false))).toBeLessThan(BUDGET_MS);
  });

  it('handles many repeated link openers in linear time', () => {
    const input = '['.repeat(N);
    expect(timed(() => applyLinkPolicy(input, () => false))).toBeLessThan(BUDGET_MS);
  });

  it('handles many repeated autolink openers in linear time', () => {
    const input = '<https://'.repeat(N / 10);
    expect(timed(() => applyLinkPolicy(input, () => false))).toBeLessThan(BUDGET_MS);
  });

  it('keeps autolink behaviour', () => {
    expect(applyLinkPolicy('go <https://a.example/x>', () => true)).toBe(
      'go <https://a.example/x>',
    );
    expect(applyLinkPolicy('go <https://a.example/x>', () => false)).toBe(
      'go `https://a.example/x`',
    );
  });

  it('handles a long whitespace run without a marker in linear time', () => {
    const input = `${' '.repeat(N)}x`;
    expect(timed(() => parseCitations(input, []))).toBeLessThan(BUDGET_MS);
  });

  it('keeps link and image behaviour for balanced URLs', () => {
    const allowAll = () => true;
    expect(applyLinkPolicy('see [docs](https://a.example/x_(y)_z)', allowAll)).toBe(
      'see [docs](https://a.example/x_(y)_z)',
    );
    expect(applyLinkPolicy('see [docs](https://a.example/x_(y)_z)', () => false)).toBe('see docs');
    expect(applyLinkPolicy('a ![i](https://a.example/p.png) b', allowAll)).toBe('a  b');
  });

  it('keeps leading whitespace handling for citation markers', () => {
    const citation = { n: 1, chunkId: 'c', documentId: 'd', title: 't', url: null };
    expect(parseCitations('Answer  [1] and [9].', [citation]).text).toBe('Answer  [1] and.');
  });
});
