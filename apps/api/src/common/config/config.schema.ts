// SPDX-License-Identifier: AGPL-3.0-only
import { isIP, isIPv4 } from 'node:net';
import { isAbsolute } from 'node:path';

import { z } from 'zod';

/** The built-in embedding models shipped in apps/api/models (spec 11.2); the first is the default. */
export const LOCAL_EMBEDDING_MODEL_IDS = ['bge-small-en-v1.5', 'multilingual-e5-small'] as const;
export type LocalEmbeddingModelId = (typeof LOCAL_EMBEDDING_MODEL_IDS)[number];

/** The validated, typed configuration the rest of the application consumes. */
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  version: string;
  publicUrl: URL;
  database: {
    url: string;
    listenUrl: string;
    ssl: false | true | 'require';
    sslCa: string | null;
  };
  auth: { secrets: Buffer[]; accessTokenTtlMin: number; refreshTokenTtlDays: number };
  widgetSecret: Buffer;
  challengeSecret: Buffer | null;
  encryptionKeys: { version: number; key: Buffer }[]; // [0] encrypts
  signupMode: 'open' | 'invite' | 'closed';
  email:
    | { transport: 'none' }
    | {
        transport: 'smtp';
        host: string;
        port: number;
        user: string | null;
        pass: string | null;
        secure: boolean;
        from: string;
      }
    | { transport: 'resend'; apiKey: string; from: string };
  storageDir: string;
  maxUploadMb: number;
  crawl: { maxPages: number; respectRobots: boolean; userAgent: string };
  providerUrls: { allowPrivate: boolean; allowlist: string[]; denylist: string[] };
  localEmbeddings: boolean;
  /** The local embedding model new bots start with; existing bots keep theirs. */
  localEmbeddingModel: LocalEmbeddingModelId;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  retention: { conversationsDays: number; tracesDays: number };
}

/**
 * Every environment variable the application reads (docs/spec.md section 21). Keep it in
 * step with `.env.example`; a unit test compares the two.
 */
export const CONFIG_ENV_KEYS = [
  'NODE_ENV',
  'PUBLIC_URL',
  'DATABASE_URL',
  'DATABASE_LISTEN_URL',
  'DATABASE_SSL',
  'DATABASE_SSL_CA',
  'AUTH_SECRET',
  'ACCESS_TOKEN_TTL_MIN',
  'REFRESH_TOKEN_TTL_DAYS',
  'WIDGET_SECRET',
  'CHALLENGE_SECRET',
  'ENCRYPTION_KEYS',
  'SIGNUP_MODE',
  'EMAIL_TRANSPORT',
  'EMAIL_FROM',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
  'RESEND_API_KEY',
  'STORAGE_DIR',
  'MAX_UPLOAD_MB',
  'CRAWL_MAX_PAGES',
  'CRAWL_RESPECT_ROBOTS',
  'CRAWL_USER_AGENT',
  'ALLOW_PRIVATE_PROVIDER_URLS',
  'PROVIDER_URL_ALLOWLIST',
  'PROVIDER_URL_DENYLIST',
  'LOCAL_EMBEDDINGS',
  'LOCAL_EMBEDDING_MODEL',
  'LOG_LEVEL',
  'RETENTION_CONVERSATIONS_DAYS',
  'RETENTION_TRACES_DAYS',
] as const;

export type ConfigEnvKey = (typeof CONFIG_ENV_KEYS)[number];

// ---------------------------------------------------------------------------
// Parsers. Each turns one raw string into a typed value, or reports a problem.
// Problem messages never contain the raw value: many variables hold secrets.
// ---------------------------------------------------------------------------

class Problem {
  constructor(readonly message: string) {}
}

type Parser<T> = (raw: string) => T | Problem;

const problem = (message: string): Problem => new Problem(message);

function oneOf<const V extends readonly string[]>(values: V): Parser<V[number]> {
  const isMember = (raw: string): raw is V[number] => values.includes(raw);
  return (raw) => (isMember(raw) ? raw : problem(`expected one of ${values.join(', ')}`));
}

const bool: Parser<boolean> = (raw) =>
  raw === 'true' ? true : raw === 'false' ? false : problem('expected true or false');

function integer(min: number, max: number = Number.MAX_SAFE_INTEGER): Parser<number> {
  return (raw) => {
    const value = /^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
    return Number.isSafeInteger(value) && value >= min && value <= max
      ? value
      : problem(
          max === Number.MAX_SAFE_INTEGER
            ? `must be an integer >= ${String(min)}`
            : `must be an integer between ${String(min)} and ${String(max)}`,
        );
  };
}

const text: Parser<string> = (raw) => raw;

function url(protocols: readonly string[], example: string): Parser<URL> {
  return (raw) => {
    const parsed = URL.canParse(raw) ? new URL(raw) : null;
    return parsed !== null && protocols.includes(parsed.protocol)
      ? parsed
      : problem(`must be an absolute URL such as ${example}`);
  };
}

const publicUrl = url(['http:', 'https:'], 'https://support.example.com');
const postgresUrl: Parser<string> = (raw) => {
  const parsed = url(['postgres:', 'postgresql:'], 'postgres://user:password@host:5432/db')(raw);
  return parsed instanceof Problem ? parsed : raw;
};

const absolutePath: Parser<string> = (raw) =>
  isAbsolute(raw) ? raw : problem('must be an absolute path');

const HOSTNAME = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/i;

function isHost(value: string): boolean {
  return isIP(value) !== 0 || (value.length <= 253 && HOSTNAME.test(value));
}

const host: Parser<string> = (raw) =>
  isHost(raw) ? raw : problem('must be a host name or IP address');

function isHostOrCidr(value: string): boolean {
  const [address = '', prefix, ...rest] = value.split('/');
  if (prefix === undefined) return isHost(address);
  const maxPrefix = isIPv4(address) ? 32 : 128;
  return (
    rest.length === 0 &&
    isIP(address) !== 0 &&
    /^\d{1,3}$/.test(prefix) &&
    Number(prefix) <= maxPrefix
  );
}

/** Comma-separated list; surrounding whitespace and empty entries are ignored. */
function list<T>(parseItem: (item: string) => T | Problem): Parser<T[]> {
  return (raw) => {
    const items: T[] = [];
    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      if (trimmed === '') continue;
      const item = parseItem(trimmed);
      if (item instanceof Problem) return item;
      items.push(item);
    }
    return items;
  };
}

const hostOrCidrList: Parser<string[]> = (raw) =>
  list((item) =>
    isHostOrCidr(item)
      ? item.toLowerCase()
      : problem('must be a comma-separated list of host names, IP addresses or CIDR ranges'),
  )(raw);

const MIN_SECRET_BYTES = 32;

function secret(message: string): Parser<Buffer> {
  return (raw) => {
    const bytes = Buffer.from(raw, 'utf8');
    return bytes.length >= MIN_SECRET_BYTES ? bytes : problem(message);
  };
}

const widgetSecret = secret(`must be at least ${String(MIN_SECRET_BYTES)} bytes`);

const EACH_SECRET_TOO_SHORT = `each secret must be at least ${String(MIN_SECRET_BYTES)} bytes`;

/** Comma-separated rotation list: the first secret signs, all of them verify. */
const authSecrets: Parser<Buffer[]> = (raw) => {
  const secrets = list(secret(EACH_SECRET_TOO_SHORT))(raw);
  return secrets instanceof Problem || secrets.length > 0
    ? secrets
    : problem(EACH_SECRET_TOO_SHORT);
};

interface EncryptionKey {
  version: number;
  key: Buffer;
}

/** `v2:<64 hex>,v1:<64 hex>`; the first entry encrypts, every entry decrypts. */
const BAD_KEY_ENTRY =
  'each entry must look like v1:<64 hex characters>, comma-separated, newest first';

const encryptionKeys: Parser<EncryptionKey[]> = (raw) => {
  const keys = list((entry) => {
    const match = /^v(\d{1,9}):([0-9a-f]{64})$/i.exec(entry);
    if (match === null) return problem(BAD_KEY_ENTRY);
    const [, version = '', hex = ''] = match;
    return { version: Number(version), key: Buffer.from(hex, 'hex') };
  })(raw);
  if (keys instanceof Problem) return keys;
  if (keys.length === 0) return problem(BAD_KEY_ENTRY);
  return new Set(keys.map((k) => k.version)).size === keys.length
    ? keys
    : problem('key versions must be unique');
};

const emailFrom: Parser<string> = (raw) =>
  /^(?:[^<>@\r\n]+<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/.test(raw)
    ? raw
    : problem('must be an email address, optionally with a name: Support <support@example.com>');

const userAgent: Parser<string> = (raw) =>
  /^[ -~]+$/.test(raw) ? raw : problem('must be printable ASCII on a single line');

// ---------------------------------------------------------------------------
// Field builders: wrap a parser into a Zod schema over `string | undefined`.
// ---------------------------------------------------------------------------

type Ctx = z.core.$RefinementCtx<string | undefined>;

function unwrap<T>(result: T | Problem, raw: string | undefined, ctx: Ctx): T {
  if (result instanceof Problem) {
    ctx.issues.push({ code: 'custom', message: result.message, input: raw });
    return z.NEVER;
  }
  return result;
}

/** The variable must be set. */
function required<T>(parse: Parser<T>) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): T =>
      unwrap(raw === undefined ? problem('is required') : parse(raw), raw, ctx),
    );
}

/** An unset variable behaves as if it were set to `fallback` (raw text, parsed as usual). */
function withDefault<T>(fallback: string, parse: Parser<T>) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): T => unwrap(parse(raw ?? fallback), raw, ctx));
}

/** An unset variable yields `null`; the caller derives its own default. */
function optional<T>(parse: Parser<T>) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): T | null => (raw === undefined ? null : unwrap(parse(raw), raw, ctx)));
}

const NODE_ENVS = ['development', 'test', 'production'] as const;
const SIGNUP_MODES = ['open', 'invite', 'closed'] as const;
const EMAIL_TRANSPORTS = ['none', 'smtp', 'resend'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

const always = (): boolean => true;

/**
 * One Zod object over the raw environment. Property order is the order problems are
 * reported in. Keys missing from `CONFIG_ENV_KEYS` (or extra ones) fail to compile.
 */
export const envSchema = z
  .object({
    NODE_ENV: withDefault('development', oneOf(NODE_ENVS)),
    PUBLIC_URL: required(publicUrl),
    DATABASE_URL: required(postgresUrl),
    DATABASE_LISTEN_URL: optional(postgresUrl),
    DATABASE_SSL: withDefault('false', oneOf(['false', 'true', 'require'])),
    DATABASE_SSL_CA: optional(text),
    AUTH_SECRET: required(authSecrets),
    ACCESS_TOKEN_TTL_MIN: withDefault('15', integer(1)),
    REFRESH_TOKEN_TTL_DAYS: withDefault('30', integer(1)),
    WIDGET_SECRET: required(widgetSecret),
    CHALLENGE_SECRET: optional(widgetSecret),
    ENCRYPTION_KEYS: required(encryptionKeys),
    SIGNUP_MODE: withDefault('invite', oneOf(SIGNUP_MODES)),
    EMAIL_TRANSPORT: withDefault('none', oneOf(EMAIL_TRANSPORTS)),
    EMAIL_FROM: optional(emailFrom),
    SMTP_HOST: optional(host),
    SMTP_PORT: optional(integer(1, 65535)),
    SMTP_USER: optional(text),
    SMTP_PASS: optional(text),
    SMTP_SECURE: withDefault('false', bool),
    RESEND_API_KEY: optional(text),
    STORAGE_DIR: withDefault('/data/files', absolutePath),
    MAX_UPLOAD_MB: withDefault('20', integer(1, 1024)),
    CRAWL_MAX_PAGES: withDefault('500', integer(1)),
    CRAWL_RESPECT_ROBOTS: withDefault('true', bool),
    CRAWL_USER_AGENT: optional(userAgent),
    ALLOW_PRIVATE_PROVIDER_URLS: withDefault('auto', oneOf(['auto', 'true', 'false'])),
    PROVIDER_URL_ALLOWLIST: withDefault('', hostOrCidrList),
    PROVIDER_URL_DENYLIST: withDefault('', hostOrCidrList),
    LOCAL_EMBEDDINGS: withDefault('true', bool),
    LOCAL_EMBEDDING_MODEL: withDefault('bge-small-en-v1.5', oneOf(LOCAL_EMBEDDING_MODEL_IDS)),
    LOG_LEVEL: withDefault('info', oneOf(LOG_LEVELS)),
    RETENTION_CONVERSATIONS_DAYS: withDefault('0', integer(0)),
    RETENTION_TRACES_DAYS: withDefault('90', integer(0)),
  } satisfies Record<ConfigEnvKey, z.ZodType>)
  // Cross-field rules. `when: always` keeps them running next to per-variable problems so
  // that one boot attempt reports everything. A variable that failed its own check holds
  // a placeholder object in the output, so these compare against `null` and exact values.
  .refine((env) => env.EMAIL_TRANSPORT !== 'smtp' || env.SMTP_HOST !== null, {
    error: 'is required when EMAIL_TRANSPORT=smtp',
    path: ['SMTP_HOST'],
    when: always,
  })
  .refine((env) => env.EMAIL_TRANSPORT !== 'resend' || env.RESEND_API_KEY !== null, {
    error: 'is required when EMAIL_TRANSPORT=resend',
    path: ['RESEND_API_KEY'],
    when: always,
  })
  .refine(
    (env) =>
      (env.EMAIL_TRANSPORT !== 'smtp' && env.EMAIL_TRANSPORT !== 'resend') ||
      env.EMAIL_FROM !== null,
    {
      error: 'is required when EMAIL_TRANSPORT is smtp or resend',
      path: ['EMAIL_FROM'],
      when: always,
    },
  );

/** The environment after validation: typed values, defaults applied, nothing derived yet. */
export type ParsedEnv = z.output<typeof envSchema>;
