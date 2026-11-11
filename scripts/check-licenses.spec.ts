// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain ESM script without type declarations
import { checkLicenses, isAllowed } from './check-licenses.mjs';

type Policy = 'agpl' | 'permissive';
const allowed = isAllowed as (expr: string, policy: Policy) => boolean;
const check = checkLicenses as (
  report: Record<string, { name: string; versions: string[]; license?: string }[]>,
  policy: Policy,
) => { count: number; violations: string[] };

describe('isAllowed (agpl policy: apps)', () => {
  it.each(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0'])(
    'allows %s',
    (l) => expect(allowed(l, 'agpl')).toBe(true),
  );
  it.each(['CC0-1.0', 'CC-BY-4.0', 'Unlicense'])('allows public-domain/data license %s', (l) =>
    expect(allowed(l, 'agpl')).toBe(true),
  );
  it.each(['LGPL-2.1-only', 'LGPL-3.0-only', 'MPL-2.0'])('allows weak copyleft %s', (l) =>
    expect(allowed(l, 'agpl')).toBe(true),
  );
  it.each(['agpl', 'permissive'] as const)(
    'allows MIT-0 (MIT without the attribution condition) under %s',
    (policy) => expect(allowed('MIT-0', policy)).toBe(true),
  );
  it('normalizes -or-later', () => expect(allowed('LGPL-3.0-or-later', 'agpl')).toBe(true));
  it.each(['GPL-3.0-only', 'Proprietary', '', 'SSPL-1.0'])('rejects %s', (l) =>
    expect(allowed(l, 'agpl')).toBe(false),
  );
  it('allows an OR expression when one branch is allowed', () =>
    expect(allowed('(MIT OR GPL-3.0-only)', 'agpl')).toBe(true));
  it('rejects an OR expression when no branch is allowed', () =>
    expect(allowed('(GPL-3.0-only OR SSPL-1.0)', 'agpl')).toBe(false));
  it('requires every branch of an AND expression', () => {
    expect(allowed('(MIT AND BSD-3-Clause)', 'agpl')).toBe(true);
    expect(allowed('(MIT AND GPL-3.0-only)', 'agpl')).toBe(false);
  });
  it('handles unparenthesized OR', () => expect(allowed('MIT OR GPL-3.0-only', 'agpl')).toBe(true));
});

describe('isAllowed (permissive policy: MIT packages)', () => {
  it.each(['LGPL-3.0-only', 'MPL-2.0'])('rejects weak copyleft %s', (l) =>
    expect(allowed(l, 'permissive')).toBe(false),
  );
  it.each(['MIT', 'Apache-2.0', 'CC0-1.0'])('allows %s', (l) =>
    expect(allowed(l, 'permissive')).toBe(true),
  );
});

describe('checkLicenses (pnpm licenses list --json shape)', () => {
  const report = {
    MIT: [{ name: 'a', versions: ['1.0.0'] }],
    'GPL-3.0-only': [{ name: 'bad', versions: ['2.0.0'] }],
    'MPL-2.0': [{ name: 'weak', versions: ['3.0.0'] }],
  };
  it('reports every violation with name, version and license', () =>
    expect(check(report, 'permissive')).toEqual({
      count: 3,
      violations: ['bad@2.0.0: GPL-3.0-only', 'weak@3.0.0: MPL-2.0'],
    }));
  it('accepts weak copyleft for apps', () =>
    expect(check(report, 'agpl').violations).toEqual(['bad@2.0.0: GPL-3.0-only']));
  it('prefers the per-package license field over the group key', () =>
    expect(
      check({ MIT: [{ name: 'x', versions: ['1'], license: 'GPL-3.0-only' }] }, 'agpl').violations,
    ).toEqual(['x@1: GPL-3.0-only']));
});
