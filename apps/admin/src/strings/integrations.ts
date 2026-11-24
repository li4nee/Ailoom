// SPDX-License-Identifier: AGPL-3.0-only
export const integrations = {
  title: 'Integrations',
  intro: 'Connect a CRM or support platform to send identified contact details from AiLoom.',
  connectTitle: 'Connect a CRM or support platform',
  connectIntro:
    'Use Continue with OAuth for an account-level authorization flow. For a provider-supported private token, enter it below and choose Connect; AiLoom encrypts it and never shows it again.',
  setupGuide: 'Integration setup guide',
  beta: 'Beta',
  betaOption: (label: string) => `${label} (beta)`,
  betaNote:
    'Beta: this connector has offline contract tests but has not been verified against a live account. Test with a sandbox before relying on it, and check Recent CRM events after the first delivery.',
  setupGuideIntro:
    'Pick a provider to get a step-by-step setup path, the least access AiLoom needs, and the exact account details to enter below.',
  credentialStepsTitle: 'Create and authorize the credential',
  requiredAccess: 'Minimum access to grant',
  whatSyncsTitle: 'What AiLoom syncs today',
  whatSyncs:
    'Only contact records: email and name. Contact created/updated events create or update a person in the selected provider. Other CRM objects and conversation/ticket activity are not currently sent by native connectors.',
  verifyTitle: 'After you connect',
  verifySteps: [
    'Use Test connection to check that the saved credential can reach the provider. This is a read/health check and does not create a CRM record.',
    'Send a test contact event from a test workspace using an email address you control. Check Recent CRM events for Delivered and the returned provider record ID.',
    'Open the CRM and confirm the contact and fields. Replay the same event and confirm it updates the same contact instead of creating a duplicate.',
  ],
  permissionsNote:
    'For OAuth, the provider app must be registered on this AiLoom instance and its redirect URI must match. The Granted scopes field below is an audit note; OAuth requests the connector defaults.',
  setupDocs: 'Open provider setup documentation',
  setupScopeNote:
    'For your audit trail, record the scopes or role granted to this credential. This field does not grant or validate permissions.',
  provider: 'Provider',
  name: 'Connection name',
  accessToken: 'Access token or API key',
  accessTokenHelp: 'This field is used only by the manual Connect option. OAuth does not use it.',
  authMode: 'Authentication method',
  bearerAuth: 'OAuth or bearer token',
  apiKeyAuth: 'API key or token',
  authUser: 'Zendesk account email',
  externalAccountId: 'External account ID (optional)',
  baseUrl: 'Provider or tenant URL',
  scopes: 'Granted scopes (optional)',
  scopesHint: 'For example: crm.objects.contacts.read, crm.objects.contacts.write',
  crmContextTitle: 'AI conversation context (optional)',
  crmContextHelp:
    'When an agent closes a conversation, AiLoom can generate a short summary, support-quality signal, lead temperature, and buyer type. Create custom fields in your CRM first, then map their internal keys here. This uses the bot’s configured model and counts toward its usage and spend cap. Unknown is used when the conversation does not support a classification.',
  crmContextProviderHelp: (provider: string) =>
    provider === 'hubspot'
      ? 'Enter HubSpot custom property internal names.'
      : provider === 'pipedrive'
        ? 'Enter Pipedrive custom field API keys.'
        : 'Enter Intercom custom attribute names.',
  crmContextSummary: 'Summary field key',
  crmContextQuality: 'Conversation quality field key',
  crmContextTemperature: 'Lead temperature field key',
  crmContextBuyerType: 'Buyer type field key',
  crmContextEvidence: 'Classification evidence field key (optional)',
  setupGuides: {
    hubspot: {
      permissions:
        'Contacts: read and write. Use crm.objects.contacts.read and crm.objects.contacts.write; no company, deal, ticket, or transcript scopes are needed.',
      steps: [
        'For a public integration, register a HubSpot OAuth app and add the exact AiLoom callback URL. The instance operator must configure the app client ID and secret in CRM_OAUTH_CLIENTS.',
        'Grant only contact read and write access in the app, then choose Continue with OAuth to authorize a portal.',
        'For a private integration limited to your own portal, a HubSpot service key can be entered below instead.',
      ],
      url: 'https://developers.hubspot.com/blog/hubspot-service-keys-the-right-api-credential-for-data-integrations',
    },
    salesforce: {
      permissions:
        'API access plus Contact Read, Create, and Edit on the integration user. Delete access is not needed.',
      steps: [
        'Use a Developer Edition org or sandbox. Register a Connected App or External Client App and add the exact AiLoom OAuth callback URL.',
        'Grant Contact Read, Create, and Edit to the authorizing integration user. Enter the org My Domain origin as the tenant URL.',
        'Choose Continue with OAuth. The instance operator must configure the app client ID and secret in CRM_OAUTH_CLIENTS.',
      ],
      url: 'https://developer.salesforce.com/docs/platform/api-rest/guide/quickstart-dev-org.html',
    },
    dynamics365: {
      permissions:
        'Dataverse Contact table: Read, Create, and Write. Assign an application user or integration user a security role with only those table privileges.',
      steps: [
        'Use a Dynamics 365 test environment. Register a web application in Microsoft Entra ID and add the exact AiLoom OAuth callback URL.',
        'Authorize a delegated user with the minimum Contact table privileges listed below. Enter the environment HTTPS origin, then choose Continue with OAuth.',
        'The instance operator must configure the Entra client ID and secret in CRM_OAUTH_CLIENTS. Do not enter the Web API path in the tenant URL.',
      ],
      url: 'https://learn.microsoft.com/en-us/dynamics365/sales/sales-trial-faq',
    },
    zoho: {
      permissions:
        'Contacts: READ, CREATE, and UPDATE. Use ZohoCRM.modules.contacts.READ, ZohoCRM.modules.contacts.CREATE, and ZohoCRM.modules.contacts.UPDATE; avoid ALL-level access.',
      steps: [
        'Use a Zoho CRM Developer Edition or sandbox. Register a server-based OAuth client and add the exact AiLoom callback URL.',
        'Enter the API origin for the account data center, such as https://www.zohoapis.com for US accounts, then choose Continue with OAuth.',
        'The instance operator must configure the Zoho client ID and secret in CRM_OAUTH_CLIENTS. AiLoom requests contact read/create/update scopes and refreshes expiring tokens.',
      ],
      url: 'https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html',
    },
    pipedrive: {
      permissions:
        'Persons/contacts: read and full write access (create and update). No deals, organizations, or activities access is needed. An API token uses the Pipedrive user permissions.',
      steps: [
        'For API-token authentication, find your token in Pipedrive under Settings > Personal preferences > API, then select API key below. No tenant URL is needed.',
        'For OAuth, register an app and add the exact AiLoom callback URL. The instance operator must configure its client ID and secret in CRM_OAUTH_CLIENTS.',
        'Contact events search for a person by exact email and update or create it.',
      ],
      url: 'https://pipedrive.readme.io/docs/developer-sandbox-account',
    },
    zendesk: {
      permissions:
        'Users: read and write. For OAuth, grant users:read and users:write. API-token auth uses the account email and an enabled Zendesk API token.',
      steps: [
        'Use a Zendesk Support test instance. Register an OAuth client and add the exact AiLoom callback URL.',
        'Grant users:read and users:write, enter the tenant origin, and choose Continue with OAuth.',
        'For a self-hosted account using an API token, choose API key authentication and enter the account email and token below.',
      ],
      url: 'https://developer.zendesk.com/api-reference/introduction/security-and-auth/',
    },
    intercom: {
      permissions:
        'Contacts: read and write. Do not grant access to conversations or other resources for the current contact sync.',
      steps: [
        'Create an app in Intercom Developer Hub, enable OAuth, and register the exact AiLoom callback URL.',
        'Enable contact read and write only, then choose Continue with OAuth. No tenant URL is needed for the US region.',
        'The instance operator must configure the Intercom client ID and secret in CRM_OAUTH_CLIENTS. A private app token can be entered below only for your own workspace.',
      ],
      url: 'https://developers.intercom.com/docs/build-an-integration/getting-started',
    },
    freshdesk: {
      permissions:
        'Contacts: read and write. An API key inherits the account user’s access; use a dedicated service account with only the required contact access.',
      steps: [
        'Use a Freshdesk test account. AiLoom currently uses an API key; OAuth redirect is not available for this connector.',
        'Choose API key authentication and enter only the tenant HTTPS origin, for example https://your-subdomain.freshdesk.com.',
        'Test connection checks the current agent. Contact events search by email and create or update the matching contact.',
      ],
      url: 'https://developers.freshdesk.com/api/',
    },
  },
  connect: 'Connect',
  connecting: 'Connecting…',
  oauthConnect: 'Continue with OAuth',
  authorizing: 'Starting authorization…',
  test: 'Test connection',
  testing: 'Testing…',
  testOk: 'Connection works.',
  testFailed: (detail: string) => `Connection test failed${detail ? `: ${detail}` : '.'}`,
  testHint: 'This checks access only; it does not send a CRM record.',
  deliveryHistory: 'Recent CRM events',
  deliveryHint: 'Delivered means the CRM returned a successful HTTP response.',
  noDeliveries: 'No CRM events sent yet.',
  deliveryStatus: {
    pending: 'Pending',
    sending: 'Sending',
    retrying: 'Retrying',
    delivered: 'Delivered',
    failed: 'Failed',
    skipped: 'Skipped',
  },
  deliveryDetails: (attempts: number, statusCode: number | null, durationMs: number | null) =>
    `${String(attempts)} ${attempts === 1 ? 'attempt' : 'attempts'}${statusCode === null ? '' : ` · HTTP ${String(statusCode)}`}${durationMs === null ? '' : ` · ${String(durationMs)} ms`}`,
  eventReference: (id: string) => `Event ${id}`,
  externalObject: (type: string, id: string) => `CRM ${type}: ${id}`,
  pause: 'Pause',
  resume: 'Resume',
  disconnect: 'Disconnect',
  disconnectTitle: (name: string) => `Disconnect ${name}?`,
  disconnectIntro: 'Queued work will be skipped and the encrypted credentials will be deleted.',
  none: 'No CRM connections yet.',
  statuses: {
    active: 'Active',
    paused: 'Paused',
    reauth_required: 'Reauthentication required',
    error: 'Error',
    disconnected: 'Disconnected',
  },
  providers: {
    hubspot: 'HubSpot',
    salesforce: 'Salesforce',
    dynamics365: 'Microsoft Dynamics 365',
    zoho: 'Zoho CRM',
    pipedrive: 'Pipedrive',
    zendesk: 'Zendesk',
    intercom: 'Intercom',
    freshdesk: 'Freshdesk',
  },
} as const;
