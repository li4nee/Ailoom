// SPDX-License-Identifier: AGPL-3.0-only

const FENCE = /^```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/u;

/**
 * Parses a JSON object a model was asked to return. Models often wrap JSON in a Markdown code
 * fence or add a short sentence around it, so this accepts a bare object, a fenced object, or
 * the outermost `{…}` span of the reply. The result is still untrusted and must be validated by
 * the caller's schema. Throws `SyntaxError` when no parseable object is present.
 */
export function parseModelJson(output: string): unknown {
  const trimmed = output.trim();
  const fenced = FENCE.exec(trimmed)?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(fenced) as unknown;
  } catch (error) {
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start === -1 || end <= start) throw error;
    return JSON.parse(fenced.slice(start, end + 1)) as unknown;
  }
}
