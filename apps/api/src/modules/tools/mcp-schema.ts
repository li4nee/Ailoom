// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from '@modelcontextprotocol/client';

import type { DiscoveredMcpTool } from '@app/shared';

import { AppError } from '../../common/errors';

const NAME = /^[a-z][a-zA-Z0-9_]{0,39}$/;
const REMOTE_NAME = /^[a-zA-Z0-9_.-]{1,128}$/;
const ROOT_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'title',
  'description',
]);
const FIELD_KEYS = new Set(['type', 'description', 'enum', 'maxLength', 'minimum', 'maximum']);

/** Convert only the deliberately small scalar JSON Schema subset the UI can review. */
export function normalizeMcpTool(tool: Tool): DiscoveredMcpTool {
  if (!REMOTE_NAME.test(tool.name)) throw new AppError('validation_failed');
  const schema = record(tool.inputSchema);
  if (schema === null || Object.keys(schema).some((key) => !ROOT_KEYS.has(key))) {
    throw new AppError('validation_failed');
  }
  if (schema['type'] !== 'object') throw new AppError('validation_failed');
  if (schema['additionalProperties'] !== undefined && schema['additionalProperties'] !== false) {
    throw new AppError('validation_failed');
  }
  const properties = record(schema['properties']);
  if (properties === null || Object.keys(properties).length > 20) {
    throw new AppError('validation_failed');
  }
  const required = schema['required'] === undefined ? [] : schema['required'];
  if (
    !Array.isArray(required) ||
    required.some((name) => typeof name !== 'string' || !Object.hasOwn(properties, name))
  ) {
    throw new AppError('validation_failed');
  }
  const requiredNames = new Set(required as string[]);
  const inputs = Object.entries(properties).map(([name, rawField]) => {
    if (!NAME.test(name)) throw new AppError('validation_failed');
    const field = record(rawField);
    if (field === null || Object.keys(field).some((key) => !FIELD_KEYS.has(key))) {
      throw new AppError('validation_failed');
    }
    const type = field['type'];
    if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean') {
      throw new AppError('validation_failed');
    }
    const normalizedType: 'string' | 'number' | 'boolean' = type === 'integer' ? 'number' : type;
    const description =
      typeof field['description'] === 'string' && field['description'].trim() !== ''
        ? field['description'].slice(0, 300)
        : `${name} value`;
    const enumValues = field['enum'];
    if (
      enumValues !== undefined &&
      (type !== 'string' ||
        !Array.isArray(enumValues) ||
        enumValues.length > 30 ||
        enumValues.some((value) => typeof value !== 'string' || value.length > 100))
    ) {
      throw new AppError('validation_failed');
    }
    const maxLength = field['maxLength'];
    if (
      maxLength !== undefined &&
      (type !== 'string' ||
        typeof maxLength !== 'number' ||
        !Number.isInteger(maxLength) ||
        maxLength < 1 ||
        maxLength > 500)
    ) {
      throw new AppError('validation_failed');
    }
    const minimum = field['minimum'];
    const maximum = field['maximum'];
    if (
      (minimum !== undefined &&
        ((type !== 'number' && type !== 'integer') ||
          typeof minimum !== 'number' ||
          !Number.isFinite(minimum) ||
          Math.abs(minimum) > 1_000_000_000)) ||
      (maximum !== undefined &&
        ((type !== 'number' && type !== 'integer') ||
          typeof maximum !== 'number' ||
          !Number.isFinite(maximum) ||
          Math.abs(maximum) > 1_000_000_000)) ||
      (minimum !== undefined && maximum !== undefined && minimum > maximum)
    ) {
      throw new AppError('validation_failed');
    }
    return {
      name,
      description,
      type: normalizedType,
      ...(type === 'integer' ? { integer: true } : {}),
      required: requiredNames.has(name),
      ...(enumValues === undefined ? {} : { enum: enumValues as string[] }),
      ...(type === 'string' ? { maxLength: maxLength ?? 500 } : {}),
      ...(type === 'number' || type === 'integer'
        ? { minimum: minimum ?? -1_000_000_000, maximum: maximum ?? 1_000_000_000 }
        : {}),
    };
  });
  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description.slice(0, 1_000) : '',
    inputs,
    readOnlyHint:
      typeof tool.annotations?.readOnlyHint === 'boolean' ? tool.annotations.readOnlyHint : null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
