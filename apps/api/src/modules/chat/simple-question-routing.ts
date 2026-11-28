// SPDX-License-Identifier: AGPL-3.0-only

const MAX_SIMPLE_QUESTION_LENGTH = 180;
const LINE_BREAK_PATTERN = /[\r\n]/;
const QUESTION_MARK_PATTERN = /[?]/g;
const COMPLEX_QUESTION_PATTERN =
  /\b(why|error|issue|broken|not working|troubleshoot|diagnos|compare|difference|chargeback|security|legal|urgent)\b/i;
const MULTI_PART_QUESTION_PATTERN = /\b(and then|also|additionally|first|second|finally)\b/i;

/**
 * Cost routing is intentionally a conservative rule, not an LLM classification step. Only the
 * current visitor message is inspected, and this function never persists or logs its contents.
 */
export function isSimpleSupportQuestion(message: string): boolean {
  const text = message.trim();
  if (
    text.length === 0 ||
    text.length > MAX_SIMPLE_QUESTION_LENGTH ||
    LINE_BREAK_PATTERN.test(text)
  ) {
    return false;
  }
  if ((text.match(QUESTION_MARK_PATTERN) ?? []).length > 1) return false;
  if (COMPLEX_QUESTION_PATTERN.test(text)) return false;
  if (MULTI_PART_QUESTION_PATTERN.test(text)) return false;
  return true;
}
