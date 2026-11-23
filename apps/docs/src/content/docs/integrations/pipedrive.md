---
title: Connect Pipedrive
description: Set up and verify a Pipedrive contact integration with AiLoom
---

# Connect Pipedrive

AiLoom sends identified contacts to Pipedrive as people. It does not create deals, organizations,
activities, support tickets, or conversation transcripts. Use a sandbox or test account if
available, and use a synthetic contact that is safe to remove.

## Connect with an API token

An API token is the quickest option for connecting your own Pipedrive account. It uses the
permissions of the Pipedrive user who owns that token.

1. In Pipedrive, open **Settings → Personal preferences → API** and copy the API token. See
   Pipedrive's [API token instructions](https://support.pipedrive.com/en/article/how-can-i-find-my-personal-api-key).
2. In AiLoom, open **Workspace → Settings → Integrations**, select **Pipedrive**, choose API key
   authentication, paste the token as the access token, give the connection a name, and connect.
3. No tenant URL is needed. Use a dedicated Pipedrive user with only the permissions needed for
   contact/person read and write.

AiLoom encrypts the token at rest and does not show it again. Pipedrive's token is associated with
the user's account, so protect it like a password and revoke or rotate it if exposed.

## OAuth for customer-connected accounts

Use OAuth when users of an integration need to authorize their own Pipedrive accounts. The AiLoom
instance operator must register a Pipedrive app, configure its client ID and secret in
`CRM_OAUTH_CLIENTS`, and register this exact redirect URI:

```text
https://<your-ailoom-host>/v1/integrations/oauth/callback/pipedrive
```

The app needs contact/person read and full write access (create and update); deal, organization,
and activity access is not needed for the current connector. Configure the server-side setting:

```dotenv
CRM_OAUTH_CLIENTS={"pipedrive":{"clientId":"...","clientSecret":"..."}}
```

Restart AiLoom after changing the environment, then choose **Continue with OAuth** and authorize
the intended account. OAuth is implemented but has not been tested against a live registered
Pipedrive app.

## Verify a contact write

1. In a test workspace, configure a bot/widget and allow the test page's origin.
2. Connect Pipedrive and use **Test connection**. This checks access and does not create a person.
3. Identify a synthetic widget visitor with both a unique email and a name:

   ```js
   await AiloomChat.identify({
     externalId: 'crm-smoke-pipedrive-001',
     email: 'crm-smoke-pipedrive-001@example.com',
     name: 'AiLoom CRM Smoke Test',
   });
   ```

4. In AiLoom's **Recent CRM events**, wait for **Delivered** and note the returned person ID.
   Search Pipedrive for the test email and verify the person.
5. Delete the test person from Pipedrive and disconnect the temporary integration.

The recorded live test used a manual API token and verified the saved connection, widget identity,
outbox, worker delivery, HTTP 200 response, and the person by readback. The test person was deleted
and the temporary integration disconnected. OAuth and live custom-field enrichment have not been
verified. See the [verification record](https://github.com/li4nee/ailoom/blob/main/docs/integrations/crm-verification.md).

## Optional conversation context fields

To sync conversation context, create custom person fields in Pipedrive first. Map each field's API
key in the optional context section when connecting or editing the integration. AiLoom can send a
summary, conversation-quality signal, lead temperature, buyer type, and optional short evidence
after an agent closes a conversation.

The enrichment uses the bot's configured chat model and spend cap. It reads recent messages to
generate the mapped values; it does not send the transcript itself to Pipedrive. Context mapping
has offline payload coverage but has not been verified against live Pipedrive custom fields.
Review generated labels before using them for consequential decisions. See [CRM context sync](/integrations/#data-sharing).

## Troubleshooting

- **401 / unauthorized:** create a new token in the intended Pipedrive account and replace the
  saved credential.
- **403 / forbidden:** check the token owner's access to people/contacts and that write access is
  available.
- **Contact not created:** provide both an email and a name. AiLoom searches for an exact email
  match and updates that person when found.
- **OAuth unavailable:** confirm `CRM_OAUTH_CLIENTS` is valid JSON and the Pipedrive app's callback
  exactly matches `PUBLIC_URL/v1/integrations/oauth/callback/pipedrive`.

See Pipedrive's [Persons API](https://developers.pipedrive.com/docs/api/v1/Persons) for the
provider's contact model.
