// SPDX-License-Identifier: AGPL-3.0-only
import { QueryFailedError } from 'typeorm';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  return (error.driverError as { code?: unknown } | undefined)?.code === UNIQUE_VIOLATION;
}
