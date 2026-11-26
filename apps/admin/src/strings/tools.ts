// SPDX-License-Identifier: AGPL-3.0-only
export const tools = {
  title: 'Tools',
  intro: 'Read-only HTTPS lookups for this bot.',
  new: 'New tool',
  discardTitle: 'Discard unsaved tool changes?',
  discardDescription: 'Your unsaved edits will be lost.',
  discardChanges: 'Discard changes',
  unsavedChanges: 'Unsaved changes. Save the tool before testing it.',
  deleteTitle: (name: string) => `Delete ${name || 'this tool'}?`,
  deleteDescription: 'This tool and its configuration will be permanently removed.',
  empty:
    'No tools yet. Add a fixed HTTPS endpoint and explicitly choose what the assistant may send and receive.',
  enabled: 'Enabled',
  disabled: 'Disabled',
  version: (number: number) => `v${String(number)}`,
  purpose: 'Purpose',
  purposeHelp: 'These rules tell the assistant when this tool fits and where it is off limits.',
  name: 'Tool name',
  description: 'Description',
  useWhen: 'Use when',
  neverUse: 'Never use when',
  failureBehavior: 'If the call fails or required information is missing',
  connectionInputs: 'Connection and inputs',
  transport: 'Tool transport',
  httpTransport: 'Read-only HTTP GET',
  mcpTransport: 'Remote MCP (Streamable HTTP)',
  connectionHelp:
    'Only the fixed HTTPS URL, GET method, configured query bindings, and optional encrypted auth header can reach the remote service. The model cannot choose a URL, header, or extra query parameter. Authentication identifies this integration, not the visitor. Verify that the endpoint is genuinely read-only; a GET request alone does not make it safe.',
  mcpConnectionHelp:
    'Only the configured HTTPS Streamable HTTP server receives the validated tool arguments and its encrypted auth header. Redirects and other origins are blocked. No visitor identity, conversation history, or other tool data is sent.',
  endpoint: 'HTTPS endpoint',
  discover: 'Discover remote tools',
  discovering: 'Contacting MCP server…',
  discoveryHelp:
    'Discovery contacts the server using only this endpoint and its saved or entered auth header. Review every description and input before saving.',
  discoveredTools: 'Discovered tools',
  unsupportedTools: (count: number) =>
    `${String(count)} remote tool(s) were hidden because their input schema is outside the supported review format.`,
  noSupportedTools: 'No tools with a supported scalar input schema were found.',
  remoteToolChanged:
    'The remote description or input schema changed. Selecting this tool starts a new review and test cycle.',
  remoteToolUnchanged: 'The remote description and input schema match the saved snapshot.',
  remoteToolMissing: 'The saved remote tool is no longer offered by this server.',
  selectRemoteTool: 'Select tool',
  readOnlyHint: (hint: boolean | null) =>
    hint === true
      ? 'Server hints read-only'
      : hint === false
        ? 'Server hints state-changing'
        : 'No read-only hint',
  remoteTool: 'Remote MCP tool name',
  remoteNameLabel: 'Remote tool',
  reviewSchema: 'I reviewed the remote description and input schema for this tool',
  approveReadOnly: 'I verified this remote tool only reads data and does not change state',
  mcpCaution:
    'The server’s readOnlyHint is advisory. Verify behavior yourself; state-changing tools are outside this release.',
  authHeader: 'Authentication header name',
  authToken: 'Authentication token',
  authHelp:
    'Optional. Stored encrypted and sent only to this fixed endpoint. Include a prefix such as “Bearer ” if the service requires one.',
  authExistingHelp: 'A token is already saved. Leave the password field blank to keep it.',
  clearAuth: 'Remove saved authentication',
  modelInputs: 'Inputs shown to the assistant',
  modelInputsHelp: 'Only list values the visitor may safely provide to the service.',
  queryBindings: 'Query bindings',
  queryBindingsHelp:
    'Input example: {"source":"input","parameter":"order_id","input":"order_id"}. Fixed values are configured here and never exposed as model arguments.',
  responseLimits: 'Response and limits',
  responseHelp:
    'Only visitor-approved response fields are returned to the assistant. Other remote fields are dropped before model context.',
  responseFields: 'Allowed response fields',
  responseFieldsHelp:
    'Each entry maps a response path: {"path":"order.status","name":"status","description":"Current order status","visibleToVisitor":true}',
  mockResponse: 'Development/test mock result',
  mockResponseHelp:
    'Use null to call the HTTPS endpoint. For local development and tests, enter a JSON object with the projected result fields. Production rejects mock results.',
  timeout: 'Timeout (ms)',
  maxCalls: 'Max calls per turn',
  testArguments: 'Test arguments',
  testArgumentsHelp: 'Used only by the admin test button; never sent to visitors.',
  enable: 'Enable this tool for visitor chats',
  enableGate:
    'Save the tool and run a successful test first. Enabling also requires reviewed tool-calling models for both the bot and its fallback. Any configuration change requires a fresh test.',
  preview: 'Data flow preview',
  previewHelp: 'The assistant receives only the listed arguments and projected result fields.',
  modelArgs: 'Model arguments',
  remoteQuery: 'Remote query',
  authPreview: 'Remote authentication',
  assistantResult: 'Assistant result',
  none: 'None',
  noQuery: 'No query parameters',
  platformCeiling:
    'Platform ceiling: 3 calls per answer, 4 model steps, 10 second timeout, and 64 KiB remote response.',
  mcpPlatformCeiling:
    'Platform ceiling: 3 calls per answer, 4 model steps, 10 second timeout, and 256 KiB MCP response.',
  save: 'Save tool',
  test: 'Test endpoint',
  testing: 'Testing…',
  testSucceeded: 'Test succeeded',
  delete: 'Delete',
  notTested: 'Not tested since this configuration was saved',
  lastTested: (date: string) => `Last successful test: ${date}`,
  invalidJson: (label: string) => `${label} must be valid JSON.`,
  invalidSettings: 'Check the tool settings.',
  status: { complete: 'Completed', started: 'Interrupted', failed: 'Failed' },
  duration: (milliseconds: number) => `in ${String(milliseconds)} ms`,
} as const;
