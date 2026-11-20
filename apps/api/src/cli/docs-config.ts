// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Regenerate the configuration reference in the docs site from CONFIG_ENV_KEYS.
 *
 *   pnpm docs:config
 *
 * The unit test fails when configuration.md is out of date, so a new environment variable
 * cannot ship undocumented.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONFIG_ENV_KEYS, type ConfigEnvKey } from '../common/config/config.schema';

const DESCRIPTIONS: Record<ConfigEnvKey, string> = {
  NODE_ENV: 'Runtime mode: `development`, `test`, or `production`.',
  DEMO_MODE:
    'Allows the mock chat provider in a production build for demo and benchmark stacks. Never enable with real users.',
  PUBLIC_URL: 'Public base URL used in emails, the widget snippet, and Caddy.',
  DATABASE_URL: 'PostgreSQL connection string. Compose builds this from `POSTGRES_*`.',
  DATABASE_LISTEN_URL:
    'Direct (non-PgBouncer) connection for LISTEN/NOTIFY. Defaults to `DATABASE_URL`.',
  DATABASE_SSL: '`false`, `true`, or `require`.',
  DATABASE_SSL_CA: 'PEM path; when set, database certificates are verified.',
  AUTH_SECRET: 'At least 32 bytes. Signs admin access JWTs; comma-separate for rotation.',
  ACCESS_TOKEN_TTL_MIN: 'Admin access token lifetime in minutes.',
  REFRESH_TOKEN_TTL_DAYS: 'Refresh token and session lifetime in days.',
  WIDGET_SECRET: 'At least 32 bytes. Signs visitor tokens.',
  CHALLENGE_SECRET:
    'At least 32 bytes. Signs proof-of-work challenges; required when a bot uses them.',
  ENCRYPTION_KEYS:
    '`v1:<64 hex>[,v0:<64 hex>]`; the highest version encrypts, every entry decrypts.',
  SIGNUP_MODE: '`open`, `invite`, or `closed`.',
  EMAIL_TRANSPORT: '`smtp`, `resend`, or `none` (logs emails).',
  EMAIL_FROM:
    'Sender address, e.g. `Support <support@example.com>`. Required when email is enabled.',
  SMTP_HOST: 'SMTP server host. Required for `EMAIL_TRANSPORT=smtp`.',
  SMTP_PORT: 'SMTP server port; defaults to 587, or 465 when `SMTP_SECURE=true`.',
  SMTP_USER: 'SMTP login, if the server needs one.',
  SMTP_PASS: 'SMTP password.',
  SMTP_SECURE: '`true` for implicit TLS (usually port 465), `false` for STARTTLS.',
  RESEND_API_KEY: 'Resend API key. Required for `EMAIL_TRANSPORT=resend`.',
  STORAGE_DIR: 'Absolute path for uploaded files; the compose stack mounts `/data/files`.',
  MAX_UPLOAD_MB: 'Largest accepted upload, in megabytes.',
  CRAWL_MAX_PAGES: 'Maximum pages fetched for one sitemap source.',
  CRAWL_RESPECT_ROBOTS: 'Honour `robots.txt` while crawling.',
  CRAWL_USER_AGENT: 'User-Agent sent by the crawler.',
  ALLOW_PRIVATE_PROVIDER_URLS:
    'Allow provider base URLs that resolve to private addresses. Off by default for SSRF safety.',
  PROVIDER_URL_ALLOWLIST:
    'Comma-separated host names, IPs, or CIDR ranges allowed as provider URLs.',
  PROVIDER_URL_DENYLIST: 'Comma-separated host names, IPs, or CIDR ranges always blocked.',
  LOCAL_EMBEDDINGS: 'Run the built-in ONNX embedding model. Disable below 2 GB RAM.',
  LOCAL_EMBEDDING_MODEL: 'Default local embedding model for new bots.',
  LOG_LEVEL: '`fatal`, `error`, `warn`, `info`, `debug`, or `trace`.',
  RETENTION_CONVERSATIONS_DAYS:
    'Hard-delete closed or AI-owned conversations with no message in this many days; human handoffs are kept. `0` disables deletion.',
  RETENTION_TRACES_DAYS: 'Delete generation traces older than this.',
  RETENTION_SESSIONS_DAYS: 'Delete revoked sessions older than this.',
};

const REQUIRED: ReadonlySet<ConfigEnvKey> = new Set([
  'PUBLIC_URL',
  'DATABASE_URL',
  'AUTH_SECRET',
  'WIDGET_SECRET',
  'ENCRYPTION_KEYS',
]);

export const CONFIG_BEGIN = '<!-- BEGIN CONFIG REFERENCE -->';
export const CONFIG_END = '<!-- END CONFIG REFERENCE -->';

export function renderConfigurationReference(): string {
  const header = ['Variable', 'Required', 'Description'];
  const rows = CONFIG_ENV_KEYS.map((key) => [
    `\`${key}\``,
    REQUIRED.has(key) ? 'yes' : 'no',
    DESCRIPTIONS[key].replaceAll('|', '\\|'),
  ]);
  // Match Prettier's table padding so regenerating the docs keeps format:check green.
  const widths = header.map((_, column) =>
    Math.max(...[header, ...rows].map((row) => row[column]?.length ?? 0)),
  );
  const renderRow = (row: string[]): string =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`;

  return [
    renderRow(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(renderRow),
  ].join('\n');
}

function configurationPath(): string {
  return resolve(__dirname, '../../../../apps/docs/src/content/docs/configuration.md');
}

export function regenerateConfigurationFile(): void {
  const path = configurationPath();
  const page = readFileSync(path, 'utf8');
  const begin = page.indexOf(CONFIG_BEGIN);
  const end = page.indexOf(CONFIG_END);
  if (begin === -1 || end === -1) {
    throw new Error(`configuration.md is missing ${CONFIG_BEGIN} / ${CONFIG_END}`);
  }
  const next =
    page.slice(0, begin + CONFIG_BEGIN.length) +
    '\n\n' +
    renderConfigurationReference() +
    '\n\n' +
    page.slice(end);
  writeFileSync(path, next);
}

if (require.main === module) {
  regenerateConfigurationFile();
  process.stdout.write('configuration.md regenerated\n');
}
