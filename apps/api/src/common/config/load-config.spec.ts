// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONFIG_ENV_KEYS } from './config.schema';
import { ConfigError, loadConfig } from './load-config';

const repoRoot = resolve(__dirname, '../../../../..');

/** Variable names in an env file: `KEY=value` lines, commented (`# KEY=value`) or not. */
function parseEnvExampleKeys(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

const valid = {
  PUBLIC_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgres://u:p@localhost/db',
  AUTH_SECRET: 'a'.repeat(32),
  WIDGET_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEYS: `v1:${'0'.repeat(64)}`,
};

describe('loadConfig', () => {
  it('reports every invalid variable at once', () => {
    expect(() => loadConfig({ SIGNUP_MODE: 'Invite' })).toThrow(
      /PUBLIC_URL[\s\S]*DATABASE_URL[\s\S]*AUTH_SECRET[\s\S]*WIDGET_SECRET[\s\S]*ENCRYPTION_KEYS[\s\S]*SIGNUP_MODE: expected one of open, invite, closed/,
    );
  });

  it('formats one `- VAR: problem` line per issue', () => {
    expect(() => loadConfig({ SIGNUP_MODE: 'Invite' })).toThrow(ConfigError);
    expect(() => loadConfig({ SIGNUP_MODE: 'Invite' })).toThrow(/^- PUBLIC_URL: is required$/m);
  });

  it('rejects short auth secrets', () => {
    expect(() => loadConfig({ ...valid, AUTH_SECRET: 'short' })).toThrow(
      /AUTH_SECRET: each secret must be at least 32 bytes/,
    );
  });

  it('parses key rings, first entry encrypts', () => {
    const c = loadConfig({
      ...valid,
      ENCRYPTION_KEYS: `v2:${'1'.repeat(64)},v1:${'0'.repeat(64)}`,
    });
    expect(c.encryptionKeys.map((k) => k.version)).toEqual([2, 1]);
    expect(c.encryptionKeys[0]?.key.length).toBe(32);
  });

  it('rejects non-hex keys', () => {
    expect(() => loadConfig({ ...valid, ENCRYPTION_KEYS: 'v1:zz' })).toThrow(/ENCRYPTION_KEYS/);
  });

  it('rejects duplicate key versions', () => {
    expect(() =>
      loadConfig({ ...valid, ENCRYPTION_KEYS: `v1:${'0'.repeat(64)},v1:${'1'.repeat(64)}` }),
    ).toThrow(/ENCRYPTION_KEYS: .*version/);
  });

  it.each([
    ['open', undefined, false],
    ['invite', undefined, true],
    ['closed', 'auto', true],
    ['open', 'true', true],
    ['invite', 'false', false],
  ])('signup %s + ALLOW_PRIVATE_PROVIDER_URLS=%s → allowPrivate %s', (mode, allow, expected) => {
    expect(
      loadConfig({ ...valid, SIGNUP_MODE: mode, ALLOW_PRIVATE_PROVIDER_URLS: allow }).providerUrls
        .allowPrivate,
    ).toBe(expected);
  });

  it('applies defaults', () => {
    const c = loadConfig(valid);
    expect(c).toMatchObject({
      signupMode: 'invite',
      maxUploadMb: 20,
      localEmbeddings: true,
      auth: { accessTokenTtlMin: 15, refreshTokenTtlDays: 30 },
      crawl: { maxPages: 500, respectRobots: true },
      retention: { conversationsDays: 0, tracesDays: 90 },
      email: { transport: 'none' },
      storageDir: '/data/files',
      nodeEnv: 'development',
      challengeSecret: null,
      database: { ssl: false, sslCa: null },
      providerUrls: { allowlist: [], denylist: [] },
      logLevel: 'info',
    });
    expect(c.database.listenUrl).toBe(valid.DATABASE_URL);
    expect(c.publicUrl).toBeInstanceOf(URL);
  });

  it('defaults the crawl user agent from the package version and PUBLIC_URL', () => {
    const c = loadConfig({ ...valid, PUBLIC_URL: 'https://support.example.com/' });
    expect(c.crawl.userAgent).toBe(`ailoom-bot/${c.version} (+https://support.example.com)`);
    expect(c.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(loadConfig({ ...valid, CRAWL_USER_AGENT: 'my-bot/1' }).crawl.userAgent).toBe('my-bot/1');
  });

  it('treats empty values like unset ones', () => {
    expect(loadConfig({ ...valid, SIGNUP_MODE: '', CHALLENGE_SECRET: '' })).toMatchObject({
      signupMode: 'invite',
      challengeSecret: null,
    });
  });

  it('requires SMTP_HOST and EMAIL_FROM for smtp', () => {
    expect(() => loadConfig({ ...valid, EMAIL_TRANSPORT: 'smtp' })).toThrow(
      /SMTP_HOST[\s\S]*EMAIL_FROM/,
    );
  });

  it('reports smtp problems together with other invalid variables', () => {
    expect(() => loadConfig({ ...valid, EMAIL_TRANSPORT: 'smtp', LOG_LEVEL: 'loud' })).toThrow(
      /LOG_LEVEL[\s\S]*SMTP_HOST[\s\S]*EMAIL_FROM/,
    );
  });

  it('builds the smtp and resend email configs', () => {
    expect(
      loadConfig({
        ...valid,
        EMAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'mail.example.com',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        SMTP_SECURE: 'true',
        EMAIL_FROM: 'Support <support@example.com>',
      }).email,
    ).toEqual({
      transport: 'smtp',
      host: 'mail.example.com',
      port: 465,
      user: 'u',
      pass: 'p',
      secure: true,
      from: 'Support <support@example.com>',
    });
    expect(
      loadConfig({
        ...valid,
        EMAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_123',
        EMAIL_FROM: 'support@example.com',
      }).email,
    ).toEqual({ transport: 'resend', apiKey: 're_123', from: 'support@example.com' });
    expect(() => loadConfig({ ...valid, EMAIL_TRANSPORT: 'resend' })).toThrow(
      /RESEND_API_KEY[\s\S]*EMAIL_FROM/,
    );
  });

  it('accepts a comma-separated AUTH_SECRET list', () => {
    expect(
      loadConfig({ ...valid, AUTH_SECRET: `${'a'.repeat(32)},${'b'.repeat(32)}` }).auth.secrets,
    ).toHaveLength(2);
  });

  it('rejects a short WIDGET_SECRET and CHALLENGE_SECRET', () => {
    expect(() => loadConfig({ ...valid, WIDGET_SECRET: 'short' })).toThrow(
      /WIDGET_SECRET: must be at least 32 bytes/,
    );
    expect(() => loadConfig({ ...valid, CHALLENGE_SECRET: 'short' })).toThrow(
      /CHALLENGE_SECRET: must be at least 32 bytes/,
    );
  });

  it('parses provider URL allow and deny lists', () => {
    const c = loadConfig({
      ...valid,
      PROVIDER_URL_ALLOWLIST: '192.168.1.20, ollama,10.0.0.0/8',
      PROVIDER_URL_DENYLIST: 'Evil.example.com',
    });
    expect(c.providerUrls).toMatchObject({
      allowlist: ['192.168.1.20', 'ollama', '10.0.0.0/8'],
      denylist: ['evil.example.com'],
    });
    expect(() => loadConfig({ ...valid, PROVIDER_URL_ALLOWLIST: 'http://x/y' })).toThrow(
      /PROVIDER_URL_ALLOWLIST/,
    );
  });

  it.each([
    ['PUBLIC_URL', 'not a url'],
    ['PUBLIC_URL', 'ftp://example.com'],
    ['DATABASE_URL', 'mysql://u:p@localhost/db'],
    ['DATABASE_SSL', 'maybe'],
    ['MAX_UPLOAD_MB', '0'],
    ['MAX_UPLOAD_MB', '1.5'],
    ['CRAWL_RESPECT_ROBOTS', 'yes'],
    ['LOCAL_EMBEDDINGS', 'yes'],
    ['LOCAL_EMBEDDING_MODEL', 'bge-large-en-v1.5'],
    ['LOG_LEVEL', 'loud'],
    ['NODE_ENV', 'staging'],
    ['STORAGE_DIR', 'relative/dir'],
    ['RETENTION_TRACES_DAYS', '-1'],
    ['ACCESS_TOKEN_TTL_MIN', 'abc'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ ...valid, [name]: value })).toThrow(new RegExp(`- ${name}: `));
  });

  it('picks the default local embedding model for new bots', () => {
    expect(loadConfig(valid).localEmbeddingModel).toBe('bge-small-en-v1.5');
    expect(
      loadConfig({ ...valid, LOCAL_EMBEDDING_MODEL: 'multilingual-e5-small' }).localEmbeddingModel,
    ).toBe('multilingual-e5-small');
  });

  it('never echoes secret values in validation errors', () => {
    const secrets = {
      AUTH_SECRET: 'hunter2-too-short',
      WIDGET_SECRET: 'widget-leak-marker',
      CHALLENGE_SECRET: 'challenge-leak-marker',
      ENCRYPTION_KEYS: 'v1:not-hex-leak-marker',
      DATABASE_URL: 'not a url with password s3cr3t-db-marker',
    };
    let error: unknown;
    try {
      loadConfig({ ...valid, ...secrets });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const text = `${String(error)} ${JSON.stringify(error)}`;
    for (const value of [
      'hunter2',
      'widget-leak-marker',
      'challenge-leak-marker',
      'not-hex-leak-marker',
      's3cr3t-db-marker',
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it('documents every variable in .env.example', () => {
    const documented = parseEnvExampleKeys(readFileSync(resolve(repoRoot, '.env.example'), 'utf8'));
    expect(documented.sort()).toEqual([...CONFIG_ENV_KEYS].sort());
  });
});
