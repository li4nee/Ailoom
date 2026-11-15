// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import type { SeedDocument } from './seed';

/** The demo help center, mirrored from the RAG quality fixture set (Task 4.11). */
export function loadSeedDocuments(): SeedDocument[] {
  const dir = join(__dirname, 'fixtures');
  return readdirSync(dir)
    .filter((file) => extname(file) === '.md')
    .sort()
    .map((file) => {
      const name = basename(file, '.md');
      return {
        title: name.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
        markdown: readFileSync(join(dir, file), 'utf8'),
      };
    });
}
