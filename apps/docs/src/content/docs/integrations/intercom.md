---
title: Connect Intercom
description: Set up and verify an Intercom contact integration with AiLoom
---

# Connect Intercom

AiLoom sends identified contact updates to Intercom. It does not create conversations, tickets,
teammate assignments, or transcript/timeline entries. Use a test workspace or a synthetic contact
that is safe to delete.

## Connect your own workspace with a private token

1. Open the [Intercom Developer Hub](https://developers.intercom.com/docs/build-an-integration/getting-started)
   and create an app for your workspace.
2. In the app's authentication settings, create a private access token. Grant contact read and
   write access only; conversation access is not needed for the current connector. Intercom's
   [authentication guide](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication)
   explains private tokens and their workspace scope.
3. In AiLoom, open **Workspace → Settings → Integrations**, select **Intercom**, choose API key
   authentication, paste the private token as the access token, name the connection, and connect.
   For the US region, no tenant URL is needed.

A private token is suitable only for a workspace you control. Do not ask another organization to
share its private token. AiLoom encrypts the token at rest and does not show it again.

## OAuth for customer-connected workspaces

Use OAuth when each customer should authorize their own Intercom workspace. Register a public
Intercom app, enable OAuth, configure contact read and write access, and register this exact
redirect URI:

```text
https://<your-ailoom-host>/v1/integrations/oauth/callback/intercom
```

The AiLoom instance operator must put the app's client ID and secret in its server-side
environment:

```dotenv
CRM_OAUTH_CLIENTS={"intercom":{"clientId":"...","clientSecret":"..."}}
```

Restart AiLoom after changing the environment, then choose **Continue with OAuth** and authorize
the intended workspace. OAuth is implemented, but has not been tested against a live registered
Intercom app. For a non-US data region, configure the provider URL/region supported by your
Intercom account before connecting; do not guess a regional host.

Intercom's [OAuth setup guide](https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth)
covers public app registration and redirect configuration.

## Verify a contact write

1. In a test workspace, configure a bot/widget and allow the test page's origin.
2. Connect Intercom and use **Test connection**. This checks access but does not create a contact.
3. Identify a synthetic widget visitor with a unique email and name:

   ```js
   await AiloomChat.identify({
     externalId: 'crm-smoke-intercom-001',
     email: 'crm-smoke-intercom-001@example.com',
     name: 'AiLoom CRM Smoke Test',
   });
   ```

4. Wait for **Delivered** in AiLoom's **Recent CRM events**. Search Intercom for the email and
   verify the contact.
5. Delete the synthetic contact in Intercom and disconnect the temporary integration.

The recorded live test used a private workspace token. It verified the saved connection, widget
identity, outbox, worker delivery, HTTP 200 response, and provider contact by readback. The test
contact was deleted and the temporary integration disconnected. OAuth and live custom-field
enrichment have not been verified. See the
[verification record](https://github.com/li4nee/ailoom/blob/main/docs/integrations/crm-verification.md).

## Optional conversation context fields

To sync conversation context, create Intercom contact custom attributes first, then map each
attribute's name in the optional context section when connecting or editing the integration.
AiLoom can send a summary, conversation-quality signal, lead temperature, buyer type, and optional
short evidence after an agent closes a conversation.

The enrichment uses the bot's configured chat model and spend cap. It reads recent messages to
produce mapped values, but it does not send the transcript itself to Intercom. Context mapping has
offline payload coverage but has not been verified against live Intercom custom attributes. Review
generated labels before using them for consequential decisions. See [CRM context sync](/integrations/#data-sharing).

## Troubleshooting

- **401 / unauthorized:** confirm the private token is current and belongs to the intended
  workspace, or complete OAuth again if the grant was revoked.
- **403 / forbidden:** check that the Intercom app has contact read/write access and that the
  authorizing user can access contacts.
- **Duplicate conflict:** AiLoom resolves an existing contact ID from Intercom's duplicate-create
  response and updates that contact.
- **OAuth unavailable:** confirm `CRM_OAUTH_CLIENTS` is valid JSON, OAuth is enabled for the app,
  and the registered callback exactly matches `PUBLIC_URL/v1/integrations/oauth/callback/intercom`.

See the [Intercom Contacts API](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts)
for the provider's contact model and supported fields.
