// SPDX-License-Identifier: AGPL-3.0-only
// Copies the architecture diagrams from the repository's docs/assets into the docs site,
// so docs/assets stays the single source of truth (run automatically before dev/build).
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '../../../docs/assets');
const to = join(here, '../public/assets');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const svgs = readdirSync(from).filter((f) => f.endsWith('.svg'));
for (const f of svgs) cpSync(join(from, f), join(to, f));
console.log(`copy-assets: ${svgs.length} diagrams copied`);
