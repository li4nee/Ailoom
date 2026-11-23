# Adding a CRM integration

This guide covers two routes:

- **Custom CRM with an HTTP endpoint:** use AiLoom's signed outbound webhooks. This needs no
  provider-specific connector and works with any system that can receive HTTPS requests.
- **Native CRM connector:** add a provider adapter when users need a first-class connection form,
  provider-specific contact matching, and delivery history in AiLoom.

Native connectors are one-way event consumers. They receive contact events and return provider
record IDs; AiLoom remains the source of truth for conversations. Capabilities must stay limited to
operations whose payloads and association behavior are implemented and verified.

## Custom CRM: use signed webhooks

In the workspace's **Settings → Integrations → Webhooks** panel:

1. Add the HTTPS endpoint exposed by the custom CRM or its integration service.
2. Select the events it should receive.
3. Save the signing secret when it is shown. AiLoom signs each request; the receiver should verify
   the signature and timestamp before processing the event.
4. Send a test event, then confirm it appears in the receiver's delivery history. Use replay to
   retry a failed delivery.

Webhook payloads are a good fit for custom CRMs, automation services, and internal middleware. The
receiver can translate AiLoom's stable event envelope into its own API calls. Keep secrets out of
the endpoint URL and make the receiver idempotent using the event ID. See the webhook event
reference and delivery history in the admin UI for the available event types and result details.

This route sends events out of AiLoom. It does not provide a generic CRM connection form, pull CRM
data into AiLoom, or create a native CRM record link in the contact sidebar.

## Native connector: implementation checklist

Use an existing provider adapter with similar authentication and API behavior as the starting point.
Keep provider-specific request and response details in `apps/api/src/modules/integrations/connectors/<provider>/`;
keep delivery orchestration provider-neutral.

1. **Define the supported operation.** Start with contact upsert. Document matching rules, duplicate
   handling, fields sent, returned record ID, and whether the provider guarantees idempotency. Do
   not advertise handoff, ticket, case, or timeline support until its provider-specific payload and
   contact association are implemented.
2. **Add the provider identifier** to `INTEGRATION_PROVIDERS`, the database provider constraint,
   and the admin setup guide and display labels. Keep API validation, database constraints, and UI
   options in sync.
3. **Implement the adapter** against the `IntegrationConnector` contract. Use `safeFetch` with the
   webhook policy for all provider requests. Validate tenant URLs as HTTPS origins. Classify auth
   errors for reauthorization, rate limits/timeouts/5xx as retryable, and other provider rejections
   as permanent failures.
4. **Register it** in `IntegrationsModule` and export it from the connectors index.
5. **Add fake-transport contract coverage** for exact method, URL, auth headers, body, success
   response parsing, external ID, zero/one/multiple contact matches, auth failures, retries, and
   unsafe tenant URLs. Tests must not make network requests.
6. **Update the provider matrix** with auth, tenant URL requirements, contact matching strategy,
   offline contract status, and live smoke status.
7. **Run a live sandbox smoke** before calling it live-verified: connect a test account, deliver a
   synthetic contact, read it back in the provider, replay the event to check for duplicates, and
   revoke the credential to confirm reauthorization behavior. Record the date and result in the
   matrix.

## Contract and code entry points

- `packages/shared/src/integrations.ts` — provider list, connect request validation, capabilities,
  and event types.
- `apps/api/src/modules/integrations/connectors/connector.ts` — provider-neutral adapter contract.
- `apps/api/src/modules/integrations/connectors/rest-crm-connector.ts` — shared REST transport,
  safe request policy, and response error classes. Use it only when its assumptions match the
  provider; do not force a provider's API into a generic payload shape.
- `apps/api/src/modules/integrations/connectors/provider-connectors.spec.ts` — shared provider
  contract fixtures.
- `docs/integrations/crm-provider-matrix.md` — current support and verification record.
- `docs/integrations/crm-verification.md` — live smoke steps and confidence limits.

The provider schema and database constraint are currently closed lists. A new built-in CRM needs a
small code migration across those lists; a custom CRM should use signed webhooks unless there is a
clear need for native contact writes and the associated setup and support burden.
