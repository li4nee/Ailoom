// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { type AppConfig, CONFIG_ENV_KEYS, envSchema, type ParsedEnv } from './config.schema';

/** One invalid or missing environment variable. */
export interface ConfigIssue {
  variable: string;
  message: string;
}

/** Thrown when the environment is invalid. `message` lists every problem, one per line. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(readonly issues: readonly ConfigIssue[]) {
    super(
      ['Invalid configuration:', ...issues.map((i) => `- ${i.variable}: ${i.message}`)].join('\n'),
    );
  }
}

const PROJECT_NAME = 'ailoom';

let cachedVersion: string | undefined;

/** The api package version. Source (src/) and build output (dist/) sit at the same depth. */
function packageVersion(): string {
  if (cachedVersion === undefined) {
    const manifest = z
      .object({ version: z.string().min(1) })
      .parse(JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')));
    cachedVersion = manifest.version;
  }
  return cachedVersion;
}

/** Env vars that are set but empty (`VAR=` in a copied .env.example) count as unset. */
function normalize(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of CONFIG_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') result[key] = value;
  }
  return result;
}

function withoutTrailingSlash(href: string): string {
  return href.endsWith('/') ? href.slice(0, -1) : href;
}

function buildEmail(env: ParsedEnv): AppConfig['email'] {
  switch (env.EMAIL_TRANSPORT) {
    case 'none':
      return { transport: 'none' };
    case 'smtp': {
      // The schema guarantees both; the check narrows the types.
      if (env.SMTP_HOST === null || env.EMAIL_FROM === null) throw invariant('smtp');
      return {
        transport: 'smtp',
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        secure: env.SMTP_SECURE,
        from: env.EMAIL_FROM,
      };
    }
    case 'resend': {
      if (env.RESEND_API_KEY === null || env.EMAIL_FROM === null) throw invariant('resend');
      return { transport: 'resend', apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
    }
  }
}

function invariant(transport: string): Error {
  return new Error(`config schema accepted an incomplete ${transport} email configuration`);
}

function buildConfig(env: ParsedEnv, version: string): AppConfig {
  const ssl = { false: false, true: true, require: 'require' } as const;
  return {
    nodeEnv: env.NODE_ENV,
    version,
    publicUrl: env.PUBLIC_URL,
    database: {
      url: env.DATABASE_URL,
      listenUrl: env.DATABASE_LISTEN_URL ?? env.DATABASE_URL,
      ssl: ssl[env.DATABASE_SSL],
      sslCa: env.DATABASE_SSL_CA,
    },
    auth: {
      secrets: env.AUTH_SECRET,
      accessTokenTtlMin: env.ACCESS_TOKEN_TTL_MIN,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    },
    widgetSecret: env.WIDGET_SECRET,
    challengeSecret: env.CHALLENGE_SECRET,
    encryptionKeys: env.ENCRYPTION_KEYS,
    signupMode: env.SIGNUP_MODE,
    email: buildEmail(env),
    storageDir: env.STORAGE_DIR,
    maxUploadMb: env.MAX_UPLOAD_MB,
    crawl: {
      maxPages: env.CRAWL_MAX_PAGES,
      respectRobots: env.CRAWL_RESPECT_ROBOTS,
      userAgent:
        env.CRAWL_USER_AGENT ??
        `${PROJECT_NAME}-bot/${version} (+${withoutTrailingSlash(env.PUBLIC_URL.href)})`,
    },
    providerUrls: {
      // `auto`: private provider URLs (a local Ollama) are fine unless anyone can sign up.
      allowPrivate:
        env.ALLOW_PRIVATE_PROVIDER_URLS === 'auto'
          ? env.SIGNUP_MODE !== 'open'
          : env.ALLOW_PRIVATE_PROVIDER_URLS === 'true',
      allowlist: env.PROVIDER_URL_ALLOWLIST,
      denylist: env.PROVIDER_URL_DENYLIST,
    },
    localEmbeddings: env.LOCAL_EMBEDDINGS,
    logLevel: env.LOG_LEVEL,
    retention: {
      conversationsDays: env.RETENTION_CONVERSATIONS_DAYS,
      tracesDays: env.RETENTION_TRACES_DAYS,
    },
  };
}

/**
 * Validates the environment and returns the typed config.
 * @throws ConfigError listing every problem, one `- VAR: problem` per line.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(normalize(env));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        variable: issue.path.map(String).join('.') || '(environment)',
        message: issue.message,
      })),
    );
  }
  return buildConfig(result.data, packageVersion());
}
