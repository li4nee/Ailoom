# M17: Outbound MCP tools

Status: Implementation and local validation in progress. M17 is not release-complete until the
integration/E2E suite and PR CI pass.

Branch: `feat/m17-outbound-mcp`, based on the M16 merge to `main`.

## Goal

Let workspace admins connect a bot to an operator-approved remote MCP server, discover its tools,
select individual read-only tools, review the captured schemas and descriptions, and execute those
tools through the same policy, projection, audit, budget, and trace boundaries as M16 HTTP tools.

## First release boundaries

- Use MCP Streamable HTTP over HTTPS. Do not launch local processes or accept stdio commands.
- Support operator-supplied static authentication headers, encrypted at rest. OAuth discovery and
  delegated user auth are separate work; never follow MCP-provided authorization URLs.
- Treat the server URL as an untrusted outbound destination. Validate every request through
  `safeFetch`, pin the configured origin, permit only public HTTPS on port 443, and reject all
  redirects. Credentials must never reach a different origin.
- Discovery is admin-only. A server's tools, descriptions, schemas, annotations, instructions,
  and results are untrusted input. An admin must select each tool and explicitly approve its
  description/schema before the tool can be enabled.
- Start with a bounded JSON Schema subset: object inputs with up to 20 scalar properties, bounded
  strings/numbers/booleans and string enums. Reject nested structures, references, extensions and
  unknown keywords rather than silently broadening a schema.
- Accept only bounded structured object results. Project only fields explicitly configured by an
  admin; do not pass through text blocks, resource links, embedded resources, or server prompts.
- Read-only status is an admin assertion recorded for review. MCP annotations such as `readOnlyHint`
  are advisory and never grant permission. State-changing tools remain disabled in this milestone.
- Never forward visitor messages, identity, conversation history, provider credentials, or unrelated
  tool secrets to an MCP server. Only validated tool arguments and the selected server credential
  cross the connection.
- Create a fresh SDK client for discovery, testing, and execution, then close it in `finally`.
  No persistent sessions, server-sent notifications, sampling, elicitation, prompts, or resources.

## Acceptance criteria

- Admin can add a named MCP connection for one bot, discover tools, select a tool, review its schema,
  configure safe-use guidance and projected outputs, test it, and enable it only after approval.
- Re-discovery detects description/schema changes and leaves the active approved snapshot unchanged
  until an admin reviews and approves a new version.
- Runtime executes only an enabled, reviewed snapshot. It validates arguments before sending them,
  enforces timeout/call/response-size limits, projects structured results, and records redacted
  invocation traces with the connection and tool version.
- Errors shown to the model and visitor do not contain remote response bodies, headers, credentials,
  endpoint query data, or server instructions.
- A failed MCP call returns a fixed `_toolFailure` marker to the model. The model follows the
  administrator's failure behavior and can continue using other reliable context; caller
  cancellation still aborts normally.
- Cross-workspace/bot isolation, SSRF/DNS rebinding, redirects, credential forwarding, schema
  rejection, output projection, version drift, timeout/abort and deletion are covered by tests.
- Existing M16 HTTP tools and their API/UX contracts continue to work.
- Admin UI makes discovery and version review clear, exposes connection health without secrets, and
  shows the approved remote tool name in traces only to authorized admins.

## Implementation steps

- [x] Inspect M16 tool, secret, trace, admin UI, safe-fetch and migration boundaries before adding
      MCP-specific persistence.
- [x] Add typed shared contracts for MCP tool bindings and discovered tool drafts without changing the
      behavior of HTTP tool definitions.
- [x] Store each bot's MCP server/tool binding as a workspace-scoped bot tool version, reuse the
      encrypted per-version auth-secret table, preserve discovery snapshots in immutable versions,
      and audit discovery. Existing bot/tool cascades handle lifecycle cleanup; no extra table is
      needed for this per-tool connection model.
- [x] Add a small MCP client adapter using the maintained TypeScript SDK and the platform's
      origin-checked `safeFetch` policy. Restrict it to Streamable HTTP and one configured origin.
- [x] Add admin APIs for create, list, rotate/clear secret, discovery, explicit selection, schema
      approval, test and deletion.
- [x] Adapt selected MCP tools into the existing provider-neutral `ProviderToolDefinition` loop;
      preserve M16 input binding, output projection, call budgets and trace redaction.
- [x] Add admin UI for connection setup, discovery, schema review, safe-use guidance, testing,
      enablement, version changes, drift notices and deletion confirmation.
- [ ] Complete fake-server and unit/integration/browser coverage, migration validation, docs, and M17
      release evidence. Current unit tests mock the safe-fetch boundary; integration tests could not
      start because no container runtime is available in this environment. Keep the live-provider
      workflow manual-only; MCP tests use local fake servers.

## References

- M16 follow-up notes in `2026-11-25-m16-tool-calling.md`.
- `docs/spec.md` Phase 3: outbound MCP and tool calling.
- [MCP TypeScript client SDK](https://github.com/modelcontextprotocol/typescript-sdk).
- [MCP tools specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx).
