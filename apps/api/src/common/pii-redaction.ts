// SPDX-License-Identifier: AGPL-3.0-only
import type { PiiRedactionCategory } from '@app/shared';

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PAYMENT_CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const PHONE = /(?:\+?\d[\d(). -]{7,}\d)/g;
const LABELED_SECRET =
  /\b(password|passcode|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Z0-9._~+/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function hasLuhnChecksum(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    const transformed = double ? digit * 2 : digit;
    sum += transformed > 9 ? transformed - 9 : transformed;
    double = !double;
  }
  return digits.length >= 13 && digits.length <= 19 && sum % 10 === 0;
}

/** Replaces selected common identifiers with stable markers before storage or external calls. */
export function redactPii(text: string, categories: readonly PiiRedactionCategory[]): string {
  if (categories.length === 0) return text;
  let output = text;
  if (categories.includes('email')) output = output.replace(EMAIL, '[REDACTED: EMAIL]');
  if (categories.includes('payment_card')) {
    output = output.replace(PAYMENT_CARD, (candidate) =>
      hasLuhnChecksum(candidate) ? '[REDACTED: PAYMENT CARD]' : candidate,
    );
  }
  if (categories.includes('phone')) output = output.replace(PHONE, '[REDACTED: PHONE]');
  if (categories.includes('credentials')) {
    output = output
      .replace(LABELED_SECRET, (_match, label: string) => `${label}=[REDACTED: CREDENTIAL]`)
      .replace(BEARER_TOKEN, 'Bearer [REDACTED: CREDENTIAL]')
      .replace(JWT, '[REDACTED: CREDENTIAL]');
  }
  return output;
}

export function redactUnknown(
  value: unknown,
  categories: readonly PiiRedactionCategory[],
): unknown {
  if (typeof value === 'string') return redactPii(value, categories);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, categories));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactUnknown(item, categories)]),
    );
  }
  return value;
}
