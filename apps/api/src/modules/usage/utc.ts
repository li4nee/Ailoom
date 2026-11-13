// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Day and month keys for `usage_daily`, always in UTC (spec §15.2). `toISOString()` is
 * time-zone independent, so a server in any zone buckets a message at the same UTC instant.
 */

/** `YYYY-MM-DD`. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The first day of `d`'s UTC month, `YYYY-MM-DD`. */
export function utcMonthStart(d: Date): string {
  return `${d.toISOString().slice(0, 7)}-01`;
}

/** `YYYY-MM`, for a spend-alert singleton key. */
export function utcMonthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
