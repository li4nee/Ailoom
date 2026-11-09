// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'LGPL-2.1-only',
  'LGPL-3.0-only',
  'MPL-2.0',
]);
const BLUEOAK = new Set(['BlueOak-1.0.0']);

function normalizeLicense(lic) {
  return lic.replace(/-or-later$/, '-only');
}

function isSimpleAllowed(depLicense) {
  const normalized = normalizeLicense(depLicense);
  return ALLOWED.has(normalized) || BLUEOAK.has(depLicense);
}

function isAllowed(expr) {
  if (!expr) return false;
  const trimmed = expr.trim();
  const orMatch = trimmed.match(/^\((.+)\s+OR\s+(.+)\)$/);
  if (orMatch) return isAllowed(orMatch[1]) || isAllowed(orMatch[2]);
  const andMatch = trimmed.match(/^\((.+)\s+AND\s+(.+)\)$/);
  if (andMatch) return isAllowed(andMatch[1]) && isAllowed(andMatch[2]);
  return isSimpleAllowed(trimmed);
}

describe('check-licenses logic', () => {
  it('allows MIT', () => expect(isAllowed('MIT')).toBe(true));
  it('allows Apache-2.0', () => expect(isAllowed('Apache-2.0')).toBe(true));
  it('allows BSD-3-Clause', () => expect(isAllowed('BSD-3-Clause')).toBe(true));
  it('allows LGPL-3.0-only', () => expect(isAllowed('LGPL-3.0-only')).toBe(true));
  it('allows MPL-2.0', () => expect(isAllowed('MPL-2.0')).toBe(true));
  it('allows BlueOak-1.0.0', () => expect(isAllowed('BlueOak-1.0.0')).toBe(true));
  it('rejects GPL-3.0-only', () => expect(isAllowed('GPL-3.0-only')).toBe(false));
  it('rejects unknown', () => expect(isAllowed('Proprietary')).toBe(false));
  it('normalizes or-later', () => expect(isAllowed('LGPL-3.0-or-later')).toBe(true));
  it('allows OR expression when one branch allowed', () =>
    expect(isAllowed('(MIT OR GPL-3.0-only)')).toBe(true));
  it('rejects OR expression when neither branch allowed', () =>
    expect(isAllowed('(GPL-3.0-only OR AGPL-3.0-only)')).toBe(false));
  it('allows AND expression when both allowed', () =>
    expect(isAllowed('(MIT AND BSD-3-Clause)')).toBe(true));
  it('rejects AND expression when one branch not allowed', () =>
    expect(isAllowed('(MIT AND GPL-3.0-only)')).toBe(false));
  it('rejects empty', () => expect(isAllowed('')).toBe(false));
});
