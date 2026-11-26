---
title: Bot API tools
description: Configure bounded read-only HTTP lookups for a support bot
---

# Bot API tools

Admins can give a bot read-only lookups through **Bot settings → Tools**. A tool has a fixed HTTPS
endpoint and GET method. The model receives only the configured input schema; the server binds
those inputs and fixed query values to the endpoint. The model cannot supply a URL, headers, or
extra query parameters. Verify that the remote endpoint is genuinely read-only; HTTP GET by itself
does not guarantee that it cannot change external state.

Each saved configuration creates a numbered, immutable version. Tool invocation records include the
version that ran, while editing a tool creates a new version and makes an already-running stale
request fail closed. Deleting a tool removes its stored versions with it.
Invocation records follow the configured trace-retention period; zero disables time-based deletion.
While the assistant checks a tool, the chat stream shows a generic progress state. It does not expose
the tool name, arguments, or returned values.

## Configure a tool

1. Add a clear name, description, use rule, off-limits rule, and failure behavior.
2. Set an HTTPS endpoint without URL credentials or query parameters. If needed, choose one auth
   header and enter its value. The value is encrypted at rest, hidden after saving, and sent only to
   that endpoint. Rotating or removing it creates a new version and requires another successful
   test. The model never sees authentication configuration.
3. List each assistant-supplied input and explicitly map it to a query parameter. Use fixed
   bindings for values the model must never choose.
4. Allowlist the response fields the assistant may receive. Only scalar strings (up to 1,000
   characters), numbers, and booleans are passed through. Nested objects, arrays, and other fields
   are dropped.
5. Set a timeout, maximum calls for one answer, and example test arguments. Save disabled, test
   the endpoint, review the data-flow preview, then enable it.

The platform caps a turn at three tool calls and four model steps. An endpoint can return up to
64 KiB and must respond with JSON over HTTPS on port 443. Redirects, private-network destinations,
and workspace platform hosts are blocked. Tool output is treated as untrusted data, not as
instructions. Tool answers do not receive document citations; document citations retain their
existing meaning.

Tool enablement requires the bot's primary and fallback chat models to be in the reviewed
tool-calling model catalog. Unknown and custom model IDs are treated as unsupported. If the bot's
model configuration later becomes incompatible, the chat runtime leaves tools out of that turn.

## Data and identity limits

The first release is for public or non-sensitive lookups, with an optional server-held auth header.
Authentication identifies the integration, not the visitor. The release does not support visitor
identity binding or write actions. Do not configure customer-specific
lookups that rely on an order number or email alone: an anonymous visitor could supply someone
else's identifier. A future authenticated tool flow must bind verified visitor identity on the
server before it can expose customer records.

The AI receives only the allowlisted response fields marked visitor-visible. The admin test action
uses the same projection and records only field names in the audit log. Tool traces store the tool
name and input/output field names, not argument values, results, or endpoint URLs. Provider request
snapshots are omitted when a tool ran because the final model request can include tool results.
Tool invocation rows are deleted with traces according to the configured trace-retention period.

## Evaluation fixtures

Evaluation cases can include up to three tool fixtures, each with a tool name, exact arguments, and a
scalar result. At run start, the evaluator snapshots the enabled tool descriptions and input/output
schema versions. A case only exposes tools named by its fixtures. The evaluator matches arguments
exactly, returns the fixture result, and marks the case failed if a fixture is missing, mismatched,
unused, or called with invalid output fields. Evaluation never calls a configured HTTP endpoint.
Keep fixture results synthetic and free of customer data.

Remote MCP servers are not part of this release. They can be added as a separate reviewed adapter
once destination approval, schema pinning, and server-held authentication are defined.
