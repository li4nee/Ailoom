// SPDX-License-Identifier: AGPL-3.0-only
import type { BotToolDto } from '@app/shared';

import { AppError } from '../../common/errors';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** The model sees only fields explicitly marked as AI supplied. */
export function modelInputSchema(tool: Pick<BotToolDto, 'inputs'>) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const field of tool.inputs) {
    properties[field.name] = {
      type: field.integer === true ? 'integer' : field.type,
      description: field.description,
      ...(field.enum === undefined ? {} : { enum: field.enum }),
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
      ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
      ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
    };
    if (field.required) required.push(field.name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Build the only arguments the model can see from the admin-approved input list. */
export function validateToolArguments(
  tool: Pick<BotToolDto, 'inputs'>,
  raw: unknown,
): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('validation_failed');
  }
  const input = raw as Record<string, unknown>;
  const fields = new Map(tool.inputs.map((field) => [field.name, field]));
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key) || !fields.has(key)) throw new AppError('validation_failed');
  }
  const output: Record<string, unknown> = {};
  for (const field of tool.inputs) {
    const value = input[field.name];
    if (value === undefined) {
      if (field.required) throw new AppError('validation_failed');
      continue;
    }
    const validType =
      (field.type === 'string' && typeof value === 'string') ||
      (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (field.type === 'boolean' && typeof value === 'boolean');
    if (!validType) throw new AppError('validation_failed');
    if (
      typeof value === 'number' &&
      ((field.minimum !== undefined && value < field.minimum) ||
        (field.maximum !== undefined && value > field.maximum) ||
        (field.integer === true && !Number.isInteger(value)))
    ) {
      throw new AppError('validation_failed');
    }
    if (typeof value === 'string') {
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        throw new AppError('validation_failed');
      }
      if (field.enum !== undefined && !field.enum.includes(value)) {
        throw new AppError('validation_failed');
      }
    }
    output[field.name] = value;
  }
  return output;
}

/** Merge only reviewed fields into the admin-fixed endpoint's query. */
export function buildToolUrl(tool: BotToolDto, rawArguments: unknown): URL {
  const args = validateToolArguments(tool, rawArguments);
  const target = new URL(tool.endpoint);
  for (const binding of tool.query) {
    const value = binding.source === 'input' ? args[binding.input] : binding.value;
    if (value !== undefined) {
      const encoded =
        typeof value === 'string'
          ? value
          : typeof value === 'number'
            ? value.toString()
            : value
              ? 'true'
              : 'false';
      target.searchParams.set(binding.parameter, encoded);
    }
  }
  return target;
}

function getPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (part === '') continue;
    if (current === null || typeof current !== 'object' || FORBIDDEN_KEYS.has(part))
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Return only allowlisted, visitor-approved fields. Raw endpoint results never reach the model. */
export function projectToolResponse(tool: BotToolDto, response: unknown): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of tool.responseFields) {
    if (!field.visibleToVisitor) continue;
    const value = getPath(response, field.path);
    if (typeof value === 'string') {
      if (value.length <= 1_000) projected[field.name] = value;
    } else if (
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      projected[field.name] = value;
    }
  }
  return projected;
}
