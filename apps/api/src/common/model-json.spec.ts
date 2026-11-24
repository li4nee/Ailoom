// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { parseModelJson } from './model-json';

describe('parseModelJson', () => {
  it('parses bare JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in a json code fence', () => {
    expect(parseModelJson('```json\n{\n"a": 1\n}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in an unlabelled fence with surrounding whitespace', () => {
    expect(parseModelJson('  \n```\n{"a":[1,2]}\n```\n')).toEqual({ a: [1, 2] });
  });

  it('parses a single object surrounded by prose', () => {
    expect(parseModelJson('Here is the result:\n{"a":"b"}\nHope this helps.')).toEqual({
      a: 'b',
    });
  });

  it('keeps braces inside string values', () => {
    expect(parseModelJson('```json\n{"a":"x } y { z"}\n```')).toEqual({ a: 'x } y { z' });
  });

  it('throws when no JSON object is present', () => {
    expect(() => parseModelJson('I cannot help with that.')).toThrow(SyntaxError);
  });

  it('throws on malformed JSON instead of guessing', () => {
    expect(() => parseModelJson('```json\n{"a": }\n```')).toThrow(SyntaxError);
  });
});
