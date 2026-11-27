// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cost routing is intentionally a conservative rule, not an LLM classification step. Only the
 * current visitor message is inspected, and this function never persists or logs its contents.
 */
export function isSimpleSupportQuestion(message: string): boolean {
  const text = message.trim();
  if (text.length === 0 || text.length > 180 || /[\r\n]/.test(text)) return false;
  if ((text.match(/[?]/g) ?? []).length > 1) return false;
  if (
    /\b(why|error|issue|broken|not working|troubleshoot|diagnos|compare|difference|chargeback|security|legal|urgent)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (/\b(and then|also|additionally|first|second|finally)\b/i.test(text)) return false;
  return true;
}
