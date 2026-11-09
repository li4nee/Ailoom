// SPDX-License-Identifier: AGPL-3.0-only
import type { LoggerOptions } from 'pino';

/** Values under these keys are replaced before anything is written or shipped. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.secret',
  '*.apiKey',
  '*.token',
  '*.authorization',
  '*.cookie',
  'password',
  'secret',
  'apiKey',
  'token',
  'authorization',
  'cookie',
];

/**
 * Pino options for the api. `redact` runs before serialization, so a secret cannot reach a
 * log sink even when the surrounding object is logged by mistake.
 */
export function buildLoggerOptions(config: { logLevel: string }): LoggerOptions {
  return {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  };
}
