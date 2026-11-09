// SPDX-License-Identifier: AGPL-3.0-only
// commit-msg hook: enforce the Developer Certificate of Origin sign-off.
import { readFileSync } from 'node:fs';

const messageFile = process.argv[2];
if (messageFile === undefined) {
  console.error('Usage: node scripts/check-signoff.mjs <commit-message-file>');
  process.exit(1);
}

const message = readFileSync(messageFile, 'utf8');
if (!/^Signed-off-by: .+ <.+>$/m.test(message)) {
  console.error('Commit must be signed off (use git commit -s)');
  process.exit(1);
}
