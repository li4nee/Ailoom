// SPDX-License-Identifier: MIT
import { z } from 'zod';

/** V1 deliberately exposes only a small input schema admins can understand and review. */
export const botToolInputFieldSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  description: z.string().trim().min(1).max(300),
  type: z.enum(['string', 'number', 'boolean']),
  integer: z.boolean().optional(),
  required: z.boolean().default(false),
  enum: z.array(z.string().max(100)).max(30).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
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
  transport: z.enum(['http', 'mcp']).default('http'),
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/),
  description: z.string().trim().min(1).max(300),
  useWhen: z.string().trim().min(1).max(1_000),
  neverUse: z.string().trim().min(1).max(1_000),
  failureBehavior: z.string().trim().min(1).max(1_000),
  enabled: z.boolean().default(false),
  endpoint: z.url().max(2_000),
  remoteToolName: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]{1,128}$/)
    .nullable()
    .default(null),
  remoteSchemaSnapshot: z.array(botToolInputFieldSchema).max(20).nullable().default(null),
  remoteDescriptionSnapshot: z.string().max(1_000).nullable().default(null),
  schemaApproved: z.boolean().default(false),
  readOnlyApproved: z.boolean().default(false),
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
    if (
      input.minimum !== undefined &&
      input.maximum !== undefined &&
      input.minimum > input.maximum
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', index, 'maximum'],
        message: 'Maximum must be greater than or equal to minimum.',
      });
    }
    if ((input.minimum !== undefined || input.maximum !== undefined) && input.type !== 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', index],
        message: 'Only number inputs can define minimum or maximum.',
      });
    }
    if (input.integer === true && input.type !== 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs', index, 'integer'],
        message: 'Only number inputs can require whole numbers.',
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

  if (tool.transport === 'mcp') {
    if (tool.remoteToolName === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['remoteToolName'],
        message: 'Select a discovered MCP tool.',
      });
    }
    if (
      tool.remoteToolName !== null &&
      (tool.remoteSchemaSnapshot === null || tool.remoteDescriptionSnapshot === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['remoteSchemaSnapshot'],
        message: 'Select the tool from a fresh server discovery before saving.',
      });
    }
    if (tool.query.length > 0 || tool.mockResponse !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'MCP tools do not use HTTP query bindings or mock responses.',
      });
    }
    if (tool.enabled && (!tool.readOnlyApproved || !tool.schemaApproved)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schemaApproved'],
        message:
          'Review the remote schema and confirm the selected tool is read-only before enabling it.',
      });
    }
  } else if (
    tool.remoteToolName !== null ||
    tool.remoteSchemaSnapshot !== null ||
    tool.remoteDescriptionSnapshot !== null ||
    tool.readOnlyApproved ||
    tool.schemaApproved
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['transport'],
      message: 'MCP review settings are only valid for MCP tools.',
    });
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

/** Safe summary returned from admin-only MCP discovery; schema is normalized before display. */
export const discoveredMcpToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/),
  description: z.string().max(1_000),
  inputs: z.array(botToolInputFieldSchema).max(20),
  readOnlyHint: z.boolean().nullable(),
});
export type DiscoveredMcpTool = z.infer<typeof discoveredMcpToolSchema>;
export const mcpDiscoveryResultSchema = z.object({
  tools: z.array(discoveredMcpToolSchema),
  unsupportedCount: z.number().int().nonnegative(),
});
export type McpDiscoveryResult = z.infer<typeof mcpDiscoveryResultSchema>;

export const discoverMcpToolsRequestSchema = z
  .object({
    toolId: z.uuid().optional(),
    endpoint: z.url().max(2_000),
    authHeaderName: z.string().max(64).nullable().default(null),
    authToken: toolAuthTokenSchema,
    timeoutMs: z.number().int().min(500).max(10_000).default(5_000),
  })
  .superRefine((input, ctx) => {
    const url = new URL(input.endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'Use a clean HTTPS endpoint.' });
    }
    if (
      input.authHeaderName !== null &&
      (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(input.authHeaderName) ||
        /^(host|connection|content-length|transfer-encoding|cookie|set-cookie|origin|referer|accept|content-type|user-agent|cache-control|pragma|te|trailer|upgrade|via|forwarded|expect)$/i.test(
          input.authHeaderName,
        ) ||
        /^(proxy-|sec-|x-forwarded-)/i.test(input.authHeaderName))
    ) {
      ctx.addIssue({ code: 'custom', path: ['authHeaderName'], message: 'Invalid auth header.' });
    }
    if (
      input.authHeaderName !== null &&
      (input.authToken === undefined || input.authToken === null) &&
      input.toolId === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authToken'],
        message: 'Enter a token for this header.',
      });
    }
    if (
      input.authHeaderName === null &&
      input.authToken !== undefined &&
      input.authToken !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authToken'],
        message: 'Choose an auth header first.',
      });
    }
  });
export type DiscoverMcpToolsRequest = z.input<typeof discoverMcpToolsRequestSchema>;
