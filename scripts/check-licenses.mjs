// SPDX-License-Identifier: AGPL-3.0-only
/**
 * check-licenses.mjs [--policy agpl|permissive]
 *
 * Reads `pnpm licenses list --prod --json` from stdin and verifies every
 * production dependency's license (architecture §6.1):
 *
 *   - permissive (MIT packages): MIT, MIT-0, ISC, BSD, Apache-2.0, 0BSD, BlueOak, plus
 *     public-domain / data licenses (CC0-1.0, Unlicense, CC-BY-4.0 data files).
 *   - agpl (AGPL apps): everything above plus weak copyleft (LGPL, MPL).
 *   - Unknown or strong-copyleft licenses fail.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PERMISSIVE = new Set([
  'MIT',
  // MIT without the attribution condition (e.g. nodemailer): strictly more permissive than MIT.
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  // Data-only packages such as caniuse-lite; attribution is satisfied by THIRD_PARTY_NOTICES.
  'CC-BY-4.0',
]);
const WEAK_COPYLEFT = new Set(['LGPL-2.1-only', 'LGPL-3.0-only', 'MPL-2.0']);

const allowedFor = (policy) =>
  policy === 'permissive' ? PERMISSIVE : new Set([...PERMISSIVE, ...WEAK_COPYLEFT]);

const stripParens = (s) => {
  const t = s.trim();
  return t.startsWith('(') && t.endsWith(')') ? t.slice(1, -1).trim() : t;
};

/** @param {string} expr SPDX expression @param {'agpl'|'permissive'} policy */
export function isAllowed(expr, policy) {
  if (!expr || !expr.trim()) return false;
  const inner = stripParens(expr);
  const or = inner.split(/\s+OR\s+/);
  if (or.length > 1) return or.some((part) => isAllowed(part, policy));
  const and = inner.split(/\s+AND\s+/);
  if (and.length > 1) return and.every((part) => isAllowed(part, policy));
  return allowedFor(policy).has(inner.replace(/-or-later$/, '-only'));
}

/**
 * @param {Record<string, {name?: string, versions?: string[], license?: string}[]>} report
 * @param {'agpl'|'permissive'} policy
 */
export function checkLicenses(report, policy) {
  const violations = [];
  let count = 0;
  for (const [groupLicense, packages] of Object.entries(report)) {
    for (const dep of packages) {
      count += 1;
      const license = dep.license || groupLicense;
      if (!isAllowed(license, policy)) {
        violations.push(`${dep.name ?? '?'}@${dep.versions?.[0] ?? '?'}: ${license || 'UNKNOWN'}`);
      }
    }
  }
  return { count, violations };
}

function main() {
  const flag = process.argv.indexOf('--policy');
  const policy = flag === -1 ? 'agpl' : process.argv[flag + 1];
  if (policy !== 'agpl' && policy !== 'permissive') {
    console.error(`check-licenses: unknown policy "${policy}" (use agpl or permissive)`);
    process.exit(2);
  }
  const raw = readFileSync(0, 'utf8').trim();
  if (!raw) {
    console.error('check-licenses: no input received on stdin');
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch (error) {
    console.error('check-licenses: failed to parse JSON input:', error.message);
    process.exit(1);
  }
  const { count, violations } = checkLicenses(report, policy);
  if (violations.length > 0) {
    console.error(`check-licenses (${policy}): license violations found (architecture §6.1):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`check-licenses (${policy}): ${count} production dependencies checked, all allowed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
