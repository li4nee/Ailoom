// SPDX-License-Identifier: AGPL-3.0-only
/**
 * check-licenses.mjs
 *
 * Reads `pnpm licenses list --prod --json` from stdin and verifies every
 * production dependency's license is compatible with an AGPL-licensed app,
 * per architecture §6.1:
 *
 *   - AGPL apps accept permissive licenses (MIT, ISC, BSD, Apache-2.0, 0BSD)
 *     plus LGPL and MPL.
 *   - Unknown licenses fail CI.
 */

import { readFileSync } from 'node:fs';

const PERMISSIVE = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);
const AGPL_EXTRA = new Set(['LGPL-2.1-only', 'LGPL-3.0-only', 'MPL-2.0']);
const ALLOWED = new Set([...PERMISSIVE, ...AGPL_EXTRA]);

// BlueOak-1.0.0 is a permissive license functionally equivalent to MIT/0BSD.
const BLUEOAK = new Set(['BlueOak-1.0.0']);

// Normalize "X-or-later" to "X-only" (or-later includes the only version).
function normalizeLicense(lic) {
  return lic.replace(/-or-later$/, '-only');
}

function isSimpleAllowed(depLicense) {
  const normalized = normalizeLicense(depLicense);
  return ALLOWED.has(normalized) || BLUEOAK.has(depLicense);
}

// Parse a license expression like "(MIT OR CC0-1.0)" or "(MIT AND BSD-3-Clause)".
function isAllowed(expr) {
  if (!expr) return false;

  const trimmed = expr.trim();

  // Handle parenthesized OR expressions: "(A OR B)"
  const orMatch = trimmed.match(/^\((.+)\s+OR\s+(.+)\)$/);
  if (orMatch) {
    return isAllowed(orMatch[1]) || isAllowed(orMatch[2]);
  }

  // Handle parenthesized AND expressions: "(A AND B)"
  const andMatch = trimmed.match(/^\((.+)\s+AND\s+(.+)\)$/);
  if (andMatch) {
    return isAllowed(andMatch[1]) && isAllowed(andMatch[2]);
  }

  return isSimpleAllowed(trimmed);
}

function main() {
  const raw = readFileSync('/dev/stdin', 'utf8').trim();
  if (!raw) {
    console.error('check-licenses: no input received on stdin');
    process.exit(1);
  }

  let licenses;
  try {
    licenses = JSON.parse(raw);
  } catch (error) {
    console.error('check-licenses: failed to parse JSON input:', error.message);
    process.exit(1);
  }

  const violations = [];
  let count = 0;

  for (const [license, packages] of Object.entries(licenses)) {
    for (const dep of packages) {
      count += 1;
      const name = dep.name || '';
      const version = (dep.versions && dep.versions[0]) || '';
      const depLicense = dep.license || license;

      if (!isAllowed(depLicense)) {
        violations.push(`  ${name}@${version}: ${depLicense || 'UNKNOWN'}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('check-licenses: license violations found (architecture §6.1):');
    violations.forEach((v) => console.error(v));
    process.exit(1);
  }

  console.log(`check-licenses: ${count} production dependencies checked, all licenses allowed.`);
  process.exit(0);
}

main();
