// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../common/config/load-config';
import { formatSecrets, generateSecrets } from './secrets-generate';

const requiredNonSecrets = {
  PUBLIC_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgres://u:p@localhost/db',
};

describe('generateSecrets', () => {
  it('produces values that pass loadConfig', () => {
    const config = loadConfig({ ...requiredNonSecrets, ...generateSecrets() });
    expect(config.auth.secrets).toHaveLength(1);
    expect(config.challengeSecret).not.toBeNull();
    expect(config.encryptionKeys).toHaveLength(1);
  });

  it('generates a version 1 encryption key ring', () => {
    expect(generateSecrets().ENCRYPTION_KEYS).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it('generates 32-byte base64url signing secrets', () => {
    const { AUTH_SECRET, WIDGET_SECRET, CHALLENGE_SECRET } = generateSecrets();
    for (const secret of [AUTH_SECRET, WIDGET_SECRET, CHALLENGE_SECRET]) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('differs between calls', () => {
    expect(generateSecrets()).not.toEqual(generateSecrets());
  });
});

describe('formatSecrets', () => {
  it('prints one KEY=value line per secret', () => {
    const secrets = generateSecrets();
    expect(formatSecrets(secrets).split('\n')).toEqual([
      `AUTH_SECRET=${secrets.AUTH_SECRET}`,
      `WIDGET_SECRET=${secrets.WIDGET_SECRET}`,
      `CHALLENGE_SECRET=${secrets.CHALLENGE_SECRET}`,
      `ENCRYPTION_KEYS=${secrets.ENCRYPTION_KEYS}`,
    ]);
  });
});
