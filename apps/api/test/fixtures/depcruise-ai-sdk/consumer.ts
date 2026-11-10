// SPDX-License-Identifier: AGPL-3.0-only
// Fixture for test/depcruise.spec.ts: a file outside src/providers/ that imports the AI SDK.
// eslint-disable-next-line no-restricted-imports -- the violation is the point of this fixture
import { generateText } from 'ai';

export const run = generateText;
