// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** V1 deliberately exposes only a small input schema admins can understand and review. */
export const botToolInputFieldSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  description: z.string().trim().min(1).max(300),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean().default(false),
  enum: z.array(z.string().max(100)).max(30).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
});

export const botToolQueryBindingSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('input'),
    parameter: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    input: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  }),
  z.object({
    source: z.literal('fixed'),
    parameter: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/),
    value: z.string().max(500),
  }),
]);

export const botToolResponseFieldSchema = z.object({
  path: z.string().regex(/^[a-zA-Z0-9_.$[\]-]{1,160}$/),
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  description: z.string().trim().min(1).max(300),
  visibleToVisitor: z.boolean().default(true),
});

/** Workspace admin configuration. Endpoint and HTTP method never come from model arguments. */
const botToolConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  description: z.string().trim().min(1).max(300),
  useWhen: z.string().trim().min(1).max(1_000),
  neverUse: z.string().trim().min(1).max(1_000),
  failureBehavior: z.string().trim().min(1).max(1_000),
  enabled: z.boolean().default(false),
  endpoint: z.url().max(2_000),
  authHeaderName: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/)
    .nullable()
    .default(null),
  inputs: z.array(botToolInputFieldSchema).max(20),
  query: z.array(botToolQueryBindingSchema).max(30),
  responseFields: z.array(botToolResponseFieldSchema).min(1).max(30),
  /** Development/test fixture: already-projected values; never accepted in production. */
  mockResponse: z
    .record(
      z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
      z.union([z.string().max(1_000), z.number(), z.boolean()]),
    )
    .nullable()
    .default(null),
  timeoutMs: z.number().int().min(500).max(10_000).default(5_000),
  maxCalls: z.number().int().min(1).max(3).default(1),
  testArguments: z.record(z.string(), z.unknown()).default({}),
});

export const createBotToolSchema = botToolConfigSchema.superRefine((tool, ctx) => {
  const inputNames = new Set<string>();
  for (const [index, input] of tool.inputs.entries()) {
    if (inputNames.has(input.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', index, 'name'],
        message: 'Input names must be unique.',
      });
    }
    inputNames.add(input.name);
    if (input.enum !== undefined && input.type !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', index, 'enum'],
        message: 'Only string inputs can use a value list.',
      });
    }
  }

  const queryNames = new Set<string>();
  for (const [index, binding] of tool.query.entries()) {
    if (queryNames.has(binding.parameter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['query', index, 'parameter'],
        message: 'Query parameters must be unique.',
      });
    }
    queryNames.add(binding.parameter);
    if (binding.source === 'input' && !inputNames.has(binding.input)) {
      ctx.addIssue({
        code: 'custom',
        path: ['query', index, 'input'],
        message: 'Choose an input defined above.',
      });
    }
  }

  const resultNames = new Set<string>();
  for (const [index, field] of tool.responseFields.entries()) {
    if (resultNames.has(field.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['responseFields', index, 'name'],
        message: 'Response names must be unique.',
      });
    }
    resultNames.add(field.name);
  }
  for (const name of Object.keys(tool.mockResponse ?? {})) {
    if (!tool.responseFields.some((field) => field.name === name && field.visibleToVisitor)) {
      ctx.addIssue({
        code: 'custom',
        path: ['mockResponse', name],
        message: 'Mock results may include only visitor-visible response fields.',
      });
    }
  }

  const url = new URL(tool.endpoint);
  if (url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'Use an HTTPS endpoint.' });
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    ctx.addIssue({
      code: 'custom',
      path: ['endpoint'],
      message: 'Endpoint cannot contain credentials, query parameters, or a fragment.',
    });
  }
  if (
    tool.authHeaderName !== null &&
    /^(host|connection|content-length|transfer-encoding|cookie|set-cookie|origin|referer|accept|content-type|user-agent|cache-control|pragma|te|trailer|upgrade|via|forwarded|expect)$/i.test(
      tool.authHeaderName,
    )
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['authHeaderName'],
      message: 'This header is managed by the platform and cannot be set here.',
    });
  }
  if (tool.authHeaderName !== null && /^(proxy-|sec-|x-forwarded-)/i.test(tool.authHeaderName)) {
    ctx.addIssue({
      code: 'custom',
      path: ['authHeaderName'],
      message: 'This header cannot be used for endpoint authentication.',
    });
  }
});

export const updateBotToolSchema = botToolConfigSchema.partial();

const toolAuthTokenSchema = z
  .string()
  .min(1)
  .max(4_000)
  .regex(/^[^\r\n]+$/)
  .nullable()
  .optional();

export const createBotToolRequestSchema = createBotToolSchema
  .extend({ authToken: toolAuthTokenSchema })
  .superRefine((tool, ctx) => {
    if (tool.authHeaderName !== null && (tool.authToken === undefined || tool.authToken === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['authToken'],
        message: 'Enter a token for the selected authentication header.',
      });
    }
    if (tool.authHeaderName === null && tool.authToken !== undefined && tool.authToken !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['authToken'],
        message: 'Choose an authentication header before entering a token.',
      });
    }
  });

export const updateBotToolRequestSchema = updateBotToolSchema.extend({
  authToken: toolAuthTokenSchema,
});

export const botToolDtoSchema = botToolConfigSchema.extend({
  id: z.uuid(),
  botId: z.uuid(),
  version: z.number().int().positive(),
  hasAuth: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  testedAt: z.string().nullable(),
});

export type BotToolInputField = z.infer<typeof botToolInputFieldSchema>;
export type CreateBotToolRequest = z.input<typeof createBotToolRequestSchema>;
export type BotToolDto = z.output<typeof botToolDtoSchema>;
