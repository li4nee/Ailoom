// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

type SecretName = 'AUTH_SECRET' | 'WIDGET_SECRET' | 'CHALLENGE_SECRET' | 'ENCRYPTION_KEYS';

/** Fresh values for the four secrets an operator has to provide. */
export function generateSecrets(): Record<SecretName, string> {
  const signingSecret = (): string => randomBytes(32).toString('base64url');
  return {
    AUTH_SECRET: signingSecret(),
    WIDGET_SECRET: signingSecret(),
    CHALLENGE_SECRET: signingSecret(),
    ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('hex')}`,
  };
}

/** `KEY=value` lines, ready to append to a `.env` file. */
export function formatSecrets(secrets: Record<SecretName, string>): string {
  return Object.entries(secrets)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
}

// Runs when started as `node src/cli/secrets-generate.ts`, not when imported (tests).
if (typeof require !== 'undefined' && require.main === module) {
  process.stdout.write(`${formatSecrets(generateSecrets())}\n`);
}
