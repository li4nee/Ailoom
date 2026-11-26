# M16: Bot tool calling

Status: M16 HTTP tool-calling implementation and mock-backed contracts complete. Production validation still needs the selected live-provider tool-calling contract and normal PR/CI review.

Branch: `feat/m16-tool-calling`, based on `main` at `ecb35a2`.

## Goal and first release

Let a workspace admin give a bot named tools that retrieve current information from explicitly
configured HTTP endpoints. For example, `lookup_product_availability(sku)` can return a small JSON
result that the bot uses in its answer. Start with public or non-sensitive information.

Confirmed first-release scope: custom read-only HTTP tools with a mock fixture for local
development. Design one tool policy and executor interface with HTTP and remote MCP adapters;
deliver HTTP first and MCP as the next optional slice on this branch. Tools that change external
state remain a later increment. An HTTP GET
method alone does not establish that an endpoint is safe or read-only; admins must control and
approve the endpoint's behavior.

## Simple configuration with explicit control

Use one Tools tab and one editor for both connection types. Present four sections, with advanced
settings collapsed and a preview showing exactly what each party receives:

1. **Purpose:** name, description, when to use it, when never to use it, required information,
   and what to say when information is missing or the call fails. Include positive and negative
   examples. Admins select which bots may use each tool and can disable it immediately.
2. **Connection and inputs:** choose HTTP endpoint or MCP connection and selected remote tool.
   Each input has a type, description, required flag, allowed values/length/range and one source:
   AI-supplied, admin-fixed, verified server context, or secret. Reserve fixed/context/secret fields
   from the model schema and reject attempts to overwrite them. The AI supplies only approved
   fields; the server validates and constructs the complete request.
3. **Response:** select allowed JSON fields to return to the AI, rename them where helpful, and
   set result/array limits. Explicitly omit internal fields. A separate visitor-visibility setting
   permits an AI-visible field to be paraphrased to the visitor; enforce visitor-hidden data by
   keeping it out of the answering model context entirely. Internal-only values stay in server
   processing. Text instructions alone cannot guarantee that a model will keep a received value
   private.
4. **Limits and test:** timeout and call count within operator ceilings, access requirements,
   example arguments and a dry preview. Show the model-visible tool definition, the actual outbound
   field mapping with secrets masked, and the projected response. An explicit Run test action then
   performs the configured read-only call and shows validation failures clearly.

New tools are disabled until saved and tested. Sending the whole conversation, visitor profile,
email, raw retrieved documents or arbitrary headers is off by default; any supported context field
must be individually selected and bound by the server. Remote systems only receive the configured
inputs and transport auth. Admins can reduce platform limits; workspace settings cannot raise
operator ceilings or allow a read-only tool to perform writes.

Generate the AI-facing description, input schema and use constraints from this configuration.
The model sees which tools are available, the permitted arguments, prerequisites and failure
behavior. Only enabled, authorized tools are offered for a turn. Recheck the policy at execution
so a tool disabled while a turn is running cannot start another call. Do not trust the prompt as
an authorization boundary: blocked fields, unknown tools and disallowed context fail validation
before any network call. Never execute an unconfigured tool or invent a successful result.

Example: `lookup_product_availability` accepts an AI-supplied SKU, a server-fixed storefront and a
secret API key. The remote API receives those configured values. The AI receives only SKU, public
product name, availability and estimated restock date. Supplier cost, internal notes and credentials
are excluded. The AI description says to request a SKU when missing and never promise availability
after a timeout. Unknown input keys and forbidden SKU values are rejected by the server.

Customer-specific order lookups require a separate identity design. The current anonymous visitor
context must not gain access to another customer's records by supplying an order number or email.
Credentials identify the workspace to the remote API; they do not identify the visitor. Sensitive
tools stay unavailable until a verified visitor identity can be bound on the server.

## Existing architecture and required changes

- `providers/Llm` owns model calls and is the only production boundary importing the AI SDK.
  Extend it with SDK-neutral tool definitions and execution callbacks. Translate those to SDK tools
  inside `providers/`; feature modules continue using the public provider exports.
- `ChatOrchestrator` currently escalates before generation when retrieval finds no relevant chunks.
  Keep that behavior for bots without enabled tools. With eligible tools, permit a bounded model
  attempt without document evidence; a successful tool result can supply evidence, otherwise use
  the existing fallback behavior. Spend caps and human takeover still take precedence.
- The platform prompt currently requires every fact to come from numbered document sources.
  Version the prompt to permit facts from validated tool results. Document citations retain their
  current meaning; tool evidence is recorded separately and never assigned a fictitious document
  citation. Tool output and visitor messages remain untrusted data, never instructions.
- M10 fallback currently depends on whether text has streamed. A tool may execute before any text
  arrives. Track execution explicitly and permit automatic provider fallback only before both tool
  execution and visible output, preventing a fresh loop from repeating executed calls.
- M15 runs the same orchestrator. Evaluations must use fixture tools by default, with production
  execution disabled. Pin tool definition versions in run metadata so configuration changes cannot
  silently alter an in-progress evaluation.

## Proposed execution path

```text
visitor message
  -> workspace / bot / conversation / spend checks
  -> retrieve knowledge + load enabled tool definitions
  -> model proposes text or tool calls
  -> enforce execution budget, tool binding and argument schema
  -> render fixed endpoint parameters + add server-held authentication
  -> safeFetch -> validate and project response fields
  -> return bounded result to model
  -> final answer -> persist trace, usage and tool invocations
```

The model chooses a configured tool name and arguments. It cannot choose a destination URL, auth
header, workspace, bot, conversation, or visitor identity. Bind those on the server from the request
context. Execute calls serially for the initial release, with an explicit total call counter that
also limits multiple calls proposed within one model step.

Proposed initial ceilings: three tool calls per answer, four model generations, ten seconds per HTTP
call, sixty seconds for the whole turn, and 32 KiB of projected tool output per call. Bound argument
size, schema depth, response bytes and per-turn concurrency as well. These are implementation
defaults to review, not current runtime behavior. Enforce before each execution; an SDK step limit
alone is insufficient. Abort signals must reach model calls and HTTP requests on disconnect or
human takeover. Limits terminate with an explicit fallback or error, never an invented success.

Use the installed AI SDK's bounded step loop behind `Llm`. Check the pinned SDK declarations during
implementation: online examples can target a different major version. Usage must aggregate every
model step, including planning and final generation. Record completed-step usage on failed/aborted
turns where available; mark unavailable usage explicitly. Recheck spend before each additional
model request and define how existing concurrent-spend limitations apply.

## Data and API design

Proposed tenant-owned tables:

- `bot_tools`: workspace, bot, stable tool ID/name, description, enabled flag and current version.
- `bot_tool_versions`: immutable argument schema, fixed endpoint template, allowed parameter
  mappings and sources, response schema/projection, AI usage rules, prerequisites, limits,
  transport type, authentication reference and creation metadata. MCP versions additionally pin
  the remote server/tool identity and discovered schema fingerprint.
- `bot_tool_auth_secrets`: separately encrypted, versioned authentication material using the
  existing `SecretBox` pattern and key-rotation job; never reuse a provider-kind credential as
  HTTP auth.
- `tool_invocations`: trace/turn correlation, tool/version, SDK call ID, sequence, status, timing,
  error code and bounded redacted arguments/results. Allocate a stable turn correlation before
  execution so failures can still be logged before the final generation trace exists.

Inspect the existing `generation_traces.tool_calls` placeholder before migration. Use it for bounded
invocation references/summary, with invocation rows providing the details. Define retention,
workspace purge ordering, credential deletion behavior and migration rollback together.

Owner/admin routes under `/v1/workspaces/:workspaceId/bots/:botId/tools` manage configuration,
enable/disable and test tools. A test call uses the same executor and is audited. Agents can inspect
redacted invocation traces within their existing permissions. Visitors never call arbitrary tools
through a general execution endpoint. Shared DTOs live in `packages/shared/src/tools.ts`; every new
route enters the isolation inventory and uses workspace-scoped repositories.

Define a restricted JSON Schema subset for v1: bounded objects, scalar properties, required fields,
enums and bounded scalar arrays; reject unknown properties, external references and unsupported
constructs. Compile it to a runtime validator inside the tool module; expose an equivalent schema
to the provider wrapper. Validate on save and on every call. Select the validator implementation
after checking installed Zod support, and document any dependency addition.

## HTTP and secret handling

Use a dedicated tool policy through `safeFetch`. Fixed HTTPS hosts and paths are admin configured;
arguments enter only explicitly allowed, encoded parameter slots. Prevent path traversal and
hostname substitution. Block private networks and platform services by default. Any future private
endpoint access needs a distinct operator policy; provider URL permissions must not implicitly
grant tool access. Reject redirects for authenticated calls.

Authenticate only on the server. Return only configured response fields, enforce byte limits before
parsing, and redact invocation storage, error messages, snapshots and UI output. Never send HTTP
auth material to the model. Remote output must not add tools, change destinations or authorize
another operation. Tool-enabled model request snapshots can contain sensitive results, so apply
the same retention and redaction policy there.

## Admin and visitor experience

Add a Tools tab to the existing bot settings design. Admins can define a tool, supply credentials,
test with example arguments and inspect a redacted response before enabling it. The editor should
describe what the tool does and which response fields the bot receives.

Start with an explicit compatibility gate for tested provider/model combinations. Do not infer
tool support from `supportsChat(provider)`; unsupported or unknown model configurations require
verification before enabling tools. Model changes must revalidate the gate, including fallback
models. Validate the mock provider plus one live adapter contract before expanding the matrix.

The playground exposes tool execution progress and trace details. The widget shows a generic
working state; raw arguments, credentials and endpoint URLs remain in the admin. If tool progress
adds SSE events, update all sinks, shared event schemas and widget handling together.

## Implementation sequence and acceptance

Implemented on the feature branch:

- Shared config and DTO schemas, fixed query binding, AI argument validation, scalar response
  projection, tenant-owned storage, admin CRUD/test routes, audit events and a migration. Each
  execution writes a redacted invocation row and links it to the final generation trace.
- HTTPS GET executor using the dedicated `safeFetch` policy: public DNS only, port 443, no redirects,
  JSON content type, bounded response bytes and timeout. This first slice deliberately has no HTTP
  auth; configure only public, non-sensitive endpoints.
- SDK-neutral bounded serial tool loop in `Llm`, workspace/bot-scoped chat wiring, no-knowledge behavior
  when tools are available, fallback protection after execution, prompt grounding rules,
  completed-step usage captured on provider failure/abort, and redacted tool name/field summaries in
  trace details.
- Admin Tools tab with explicit purpose/limits, JSON field mappings, successful-test-before-enable
  enforcement tied to a canonical config digest, data-flow preview, and current version display.
- Immutable tool config snapshots, version-pinned invocation rows, stale-test protection, and
  invocation cleanup batched with configured trace retention.
- Optional single-header endpoint authentication is sealed with `SecretBox` in a separate
  versioned table. The model and DTO never receive the token; key rotation includes tool secrets,
  and changing or clearing authentication invalidates the test gate.
- Admin test attempts are audited on success and failure with only status, a safe error code, and
  projected field names; remote values and credentials are excluded.
- Model compatibility is explicit in the shipped model catalog. Tool enablement requires reviewed
  primary and fallback model entries; unknown/custom IDs default to unsupported, and runtime chat
  suppresses tools if the current bot model pair is incompatible.
- The three M16 migrations were applied to the local development database, a clean E2E database
  migrated successfully, and `db:check` reports no schema drift. Workspace purge now includes
  invocation, auth-secret, version, and definition rows in dependency order.
- Generic `answer.progress` events show a localized checking state while a tool runs. The event
  exposes no tool name, arguments, or results; widget and playground consume it.
- Operator documentation at `apps/docs/src/content/docs/tool-calling.md`.

- [x] 1. Contracts and persistence: shared config/DTO, tenant-owned current definitions, migration,
      redacted invocation records linked to traces, audit and owner/admin CRUD are implemented.
      Immutable config versions are stored and invocations pin the version used; trace-retention cleanup deletes old invocation summaries. Route-isolation inventory is covered. Workspace/bot deletion
      cascades invocation rows; disabled-by-default and tested-before-enable are enforced.
- [x] 2. Executor: argument validation, fixed URL rendering, scalar response projection, cancellation,
      dedicated `safeFetch` policy, and optional encrypted auth-header injection are implemented.
      Deterministic fixture responses are available in development/test only; v1 remains read-only.
- [x] 3. Provider and chat integration: bounded serial loop, aggregate successful-call usage, fallback
      boundary, prompt grounding and retrieval behavior are implemented. Completed-step usage is
      recorded for failed/aborted streams when the provider reports it. Detailed invocation traces
      are available; catalog gating is implemented. A reusable contract verifies the complete
      provider tool-call, server execution, and final-answer round trip against the mock provider.
      The same contract is available for one explicitly selected live provider in the manual CI
      workflow; that live run remains a release validation item.
- [x] 4. Admin and trace UI: config, successful test, enablement, version display and a redacted
      name/field/version trace summary are implemented.
- [x] 5. Evaluation and release evidence: fixture tool registry, pinned tool versions, tool selection
      and argument expectations are implemented with case-specific fixtures and run-start definition
      snapshots. Fixture mismatches fail the case, and eval runs never call live endpoints. Failure/limit
      behavior, browser coverage, migration checks, and operator docs are implemented. The browser
      acceptance configures a fixture, tests/enables it, answers without documents, checks the linked
      invocation trace, disables it, and observes the normal fallback.

Meaningful tests must cover: cross-workspace IDs, disabled tools, malformed arguments, unauthorized
visitor context, SSRF/redirect attempts, response injection, secret redaction, multiple calls in one
step, timeouts, abort/takeover, usage aggregation, fallback before/after execution and no-tool chat
regressions. Browser coverage should configure a mock tool, get an answer with no document sources,
inspect its trace, disable the tool and observe the fallback. Evaluations must never reach a real
tool endpoint by default.

Validation completed for this milestone: API unit suite (739 passed, 7 skipped); API chat integration
(20 passed); workspace purge and ingestion integration files (19 passed); API isolation E2E (5 passed);
tool-calling browser flow (1 passed); workspace typecheck, lint, build, and database schema check all
passed. The mock provider tool-calling contract passed in the unit suite. The live tool-calling
contract has not run because no provider key is configured in this workspace. The first broad integration run caught the missing workspace-purge entries and one transient
ingestion failure; both affected integration files passed on rerun after the purge-order fix. One
disabled live-provider contract test still produces the existing lint warning. The release owner
should run one live adapter contract with a dedicated provider credential before enabling real model
traffic. Unknown/custom model IDs remain denied. Authenticated visitor identity binding and customer-
specific lookups remain outside this milestone; remote MCP remains an optional follow-up adapter.

## Follow-up increments

Optional MCP slice: admins connect a remote MCP server, discover tools, explicitly select read-only
tools and configure the same input sources, use rules, response projection and limits as HTTP tools.
The connection is a tool source; it grants no automatic access to every discovered capability.
Execute through the same binding, validation, budget, trace and auth interface. Keep transport and
SDK-specific code behind adapters and the existing provider boundary rules.

Use remote HTTP transport with operator-approved destinations and server-held authentication.
Local process/stdio servers and arbitrary shell commands are outside this slice. Ensure SDK discovery,
authentication metadata and execution traffic all use approved outbound URL policies, with scoped
credentials and no token forwarding to unrelated origins. Specify and test the supported auth
flow before choosing the MCP SDK dependency.

Discovered descriptions, server instructions, schemas, annotations and outputs are untrusted input.
Admin-review tool descriptions and pin approved schema versions. New tools and changed schemas
require review before becoming available; a remote `readOnlyHint` is advisory and cannot authorize
execution. Limit schema complexity and reject unsupported constructs explicitly. Start with tools
whose bounded structured results can be projected reliably; do not pass through raw text, resource
links or embedded resources around the response allowlist. Sampling, elicitation and unrelated MCP
capabilities are disabled for this slice. A server must enforce read-only permissions on its own
credentials; the client cannot prove remote behavior from annotations.

Tools that change state
need durable pending invocations, authenticated confirmation bound to exact versioned arguments,
expiry, idempotency keys and reconciliation after uncertain network outcomes. These remain outside
the initial read-only execution loop.

## References

- Repository spec sections 11.3, 13, 15, 23 and 27; ADR-003.
- [AI SDK tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
- [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control).
- [MCP tools specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx).
