// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { AppError } from '../../common/errors';
import { normalizeMcpTool } from './mcp-schema';

function remoteTool(inputSchema: unknown, extra: Record<string, unknown> = {}) {
  return {
    name: 'lookup_status',
    description: 'Read current status.',
    inputSchema,
    ...extra,
  } as never;
}

describe('normalizeMcpTool', () => {
  it('maps bounded scalar fields and keeps read-only hints advisory', () => {
    expect(
      normalizeMcpTool(
        remoteTool(
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'integer', minimum: 1, maximum: 99, description: 'Status id.' },
              region: { type: 'string', enum: ['us', 'eu'], maxLength: 8 },
            },
            required: ['id'],
          },
          { annotations: { readOnlyHint: true } },
        ),
      ),
    ).toEqual({
      name: 'lookup_status',
      description: 'Read current status.',
      readOnlyHint: true,
      inputs: [
        {
          name: 'id',
          description: 'Status id.',
          type: 'number',
          integer: true,
          required: true,
          minimum: 1,
          maximum: 99,
        },
        {
          name: 'region',
          description: 'region value',
          type: 'string',
          required: false,
          enum: ['us', 'eu'],
          maxLength: 8,
        },
      ],
    });
  });

  it.each([
    ['nested schema', { type: 'object', properties: { value: { type: 'object' } } }],
    ['schema reference', { type: 'object', $ref: '#/$defs/input', properties: {} }],
    ['unknown keyword', { type: 'object', properties: {}, patternProperties: {} }],
    [
      'overlong strings',
      { type: 'object', properties: { value: { type: 'string', maxLength: 501 } } },
    ],
    [
      'unbounded additional properties',
      { type: 'object', additionalProperties: true, properties: {} },
    ],
  ])('rejects %s', (_label, schema) => {
    expect(() => normalizeMcpTool(remoteTool(schema))).toThrow(AppError);
  });

  it('rejects tool names outside the approved remote-name format', () => {
    const invalidTool = {
      ...(remoteTool({ type: 'object', properties: {} }) as object),
      name: 'bad tool',
    };
    expect(() => normalizeMcpTool(invalidTool as never)).toThrow(AppError);
  });
});
