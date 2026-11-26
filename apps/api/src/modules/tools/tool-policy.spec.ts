// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { botToolDtoSchema } from '@app/shared';

import { buildToolUrl, projectToolResponse, validateToolArguments } from './tool-policy';

const tool = botToolDtoSchema.parse({
  id: '0193b502-331d-7b12-8af4-6322e278e3f1',
  botId: '0193b502-331d-7b12-8af4-6322e278e3f2',
  version: 1,
  hasAuth: false,
  name: 'lookup_product',
  description: 'Check public availability.',
  useWhen: 'Use when asked about stock.',
  neverUse: 'Never use for supplier stock.',
  failureBehavior: 'If unavailable, say you could not check.',
  enabled: true,
  endpoint: 'https://shop.example/api/products',
  inputs: [
    {
      name: 'sku',
      description: 'Product SKU',
      type: 'string',
      required: true,
      maxLength: 30,
    },
  ],
  query: [
    { source: 'input', parameter: 'sku', input: 'sku' },
    { source: 'fixed', parameter: 'store', value: 'public' },
  ],
  responseFields: [
    {
      path: 'product.available',
      name: 'available',
      description: 'Stock availability.',
      visibleToVisitor: true,
    },
    {
      path: 'product.supplierCost',
      name: 'supplier_cost',
      description: 'Internal supplier cost.',
      visibleToVisitor: false,
    },
  ],
  timeoutMs: 5_000,
  maxCalls: 1,
  testArguments: {},
  createdAt: '2026-11-25T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
  testedAt: null,
});

describe('tool policy', () => {
  it('accepts only configured model inputs and binds them to the fixed endpoint', () => {
    const url = buildToolUrl(tool, { sku: 'ABC 42' });
    expect(url.origin + url.pathname).toBe('https://shop.example/api/products');
    expect(url.searchParams.get('sku')).toBe('ABC 42');
    expect(url.searchParams.get('store')).toBe('public');
    expect(() =>
      validateToolArguments(tool, { sku: 'ABC', endpoint: 'https://evil.test' }),
    ).toThrow();
  });

  it('enforces input types and size constraints before producing a request', () => {
    expect(() => validateToolArguments(tool, { sku: 42 })).toThrow();
    expect(() => validateToolArguments(tool, { sku: 'x'.repeat(31) })).toThrow();
  });

  it('returns only explicitly selected visitor-visible response fields', () => {
    expect(
      projectToolResponse(tool, {
        product: { available: true, supplierCost: 9.5, internalNotes: 'hidden' },
        accessToken: 'secret',
      }),
    ).toEqual({ available: true });
  });
});
