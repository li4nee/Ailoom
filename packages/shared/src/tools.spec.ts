// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { createBotToolSchema } from './tools.js';

const validTool = {
  name: 'lookup_product',
  description: 'Check public product availability.',
  useWhen: 'The visitor asks whether a product is in stock.',
  neverUse: 'Never use for pricing or supplier inventory.',
  failureBehavior: 'If unavailable, say you could not check and offer a person.',
  endpoint: 'https://shop.example/api/products',
  inputs: [{ name: 'sku', description: 'Product SKU', type: 'string', required: true }],
  query: [
    { source: 'input', parameter: 'sku', input: 'sku' },
    { source: 'fixed', parameter: 'store', value: 'web' },
  ],
  responseFields: [
    {
      path: 'product.available',
      name: 'available',
      description: 'Whether the product is available.',
      visibleToVisitor: true,
    },
  ],
};

describe('bot tool configuration', () => {
  it('accepts a fixed HTTPS endpoint with reviewed inputs and response fields', () => {
    expect(createBotToolSchema.safeParse(validTool).success).toBe(true);
  });

  it.each([
    'http://shop.example/api',
    'https://user:pass@shop.example/api',
    'https://shop.example/api?token=secret',
  ])('rejects unsafe or hidden endpoint configuration: %s', (endpoint) => {
    expect(createBotToolSchema.safeParse({ ...validTool, endpoint }).success).toBe(false);
  });

  it('rejects query mappings to inputs that do not exist', () => {
    expect(
      createBotToolSchema.safeParse({
        ...validTool,
        query: [{ source: 'input', parameter: 'sku', input: 'missing' }],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate query names so the outbound request is unambiguous', () => {
    expect(
      createBotToolSchema.safeParse({
        ...validTool,
        query: [
          { source: 'fixed', parameter: 'store', value: 'web' },
          { source: 'fixed', parameter: 'store', value: 'admin' },
        ],
      }).success,
    ).toBe(false);
  });
});
