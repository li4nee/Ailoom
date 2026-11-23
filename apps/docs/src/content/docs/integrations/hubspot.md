---
title: Connect HubSpot
description: Set up and verify a HubSpot contact integration with AiLoom
---

# Connect HubSpot

AiLoom sends identified contact updates to HubSpot. The connector does not import contacts or
create deals, tickets, conversation activities, or transcript records. Use a HubSpot developer
account or a portal where you can safely create and remove a synthetic contact.

## Choose a credential

### Service key for your own portal

Use a service key when connecting a portal you control. HubSpot service keys can be scoped to the
permissions an integration needs; grant only contact read and write:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`

In HubSpot, create a service key from the account's developer or integrations settings, enable the
two contact scopes, and copy the key. In AiLoom, open **Workspace → Settings → Integrations**,
select **HubSpot**, choose API key/manual authentication, paste the key as the access token, give
the connection a recognizable name, and connect. AiLoom encrypts the credential at rest and does
not show it again.

See HubSpot's [Service Keys documentation](https://developers.hubspot.com/changelog/service-keys)
for current account availability and creation steps.

### OAuth for an integration used by other portals

OAuth is the right fit when each HubSpot customer should authorize their own portal. The operator
of the AiLoom instance must register a HubSpot app, configure its client ID and secret in
`CRM_OAUTH_CLIENTS`, and add this exact redirect URI to the app:

```text
https://<your-ailoom-host>/v1/integrations/oauth/callback/hubspot
```

Use `https://` and make the host match the instance's `PUBLIC_URL`. Grant the same two contact
scopes above. The server-side environment setting is JSON:

```dotenv
CRM_OAUTH_CLIENTS={"hubspot":{"clientId":"...","clientSecret":"..."}}
```

Restart AiLoom after changing environment configuration, then select **Continue with OAuth** in
the Integrations page and authorize the intended portal. OAuth is implemented, but has not yet
been tested against a live registered HubSpot app.

## Verify a contact write

1. In a test workspace, create a bot/widget and allow the test page's origin.
2. Connect HubSpot and use **Test connection**. This checks access; it does not write a contact.
3. Identify a synthetic widget visitor with a unique email address you control. For example:

   ```js
   await AiloomChat.identify({
     externalId: 'crm-smoke-hubspot-001',
     email: 'crm-smoke-hubspot-001@example.com',
     name: 'AiLoom CRM Smoke Test',
   });
   ```

4. Open **Recent CRM events** and wait for the contact event to show **Delivered**. Open HubSpot
   and search for the test email to verify the record yourself.
5. Delete the synthetic contact in HubSpot and disconnect the temporary AiLoom integration.

The live check recorded for HubSpot passed through AiLoom's connection, widget identity, outbox,
and worker, with an HTTP 200 delivery receipt and a provider contact ID. The record was not read
back from HubSpot as part of that check. OAuth and live custom-field enrichment have not been
verified. See the [verification record](https://github.com/li4nee/ailoom/blob/main/docs/integrations/crm-verification.md)
for details.

## Optional conversation context fields

AiLoom can write a generated summary, conversation-quality signal, lead temperature, buyer type,
and optional classification evidence after an agent closes a conversation. To use this, first
create HubSpot contact properties, then map each property's **internal name** in the optional
context section while creating or editing the integration. A property must accept the value type
AiLoom sends; use text properties for summary and evidence and suitable text or enumeration
properties for labels.

This job uses the bot's configured chat model and counts toward its spend cap. It reads recent
conversation messages to produce the mapped fields, but does not send the transcript to HubSpot.
Context mapping has offline payload coverage but has not been verified against live HubSpot custom
properties. Review AI-generated classifications before using them for consequential decisions.
See [CRM context sync](/integrations/#data-sharing) for the shared behavior and limits.

## Troubleshooting

- **401 / unauthorized:** check that the service key is current, belongs to the intended portal,
  and includes contact read and write scopes.
- **403 / forbidden:** check the authorizing user's access to contacts and the key's granted scopes.
- **No CRM event:** `identify()` must run for an authenticated, verified visitor in the correct
  workspace. Anonymous contact events without an email cannot create a HubSpot contact.
- **OAuth unavailable:** confirm `CRM_OAUTH_CLIENTS` is valid JSON and the registered callback
  exactly matches `PUBLIC_URL/v1/integrations/oauth/callback/hubspot`.

For HubSpot's API contract, see [contact batch upsert](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/objects/batch/upsert-objects).
