// SPDX-License-Identifier: AGPL-3.0-only
import { sha256Hex } from '../../src/common/crypto';
import { newId } from '../../src/common/ids';
import type { WorkspaceId } from '../../src/db/ids';
import type { TestApp } from '../helpers/app';
import { createUser } from '../helpers/factories';

/** Two workspaces with one owner each; B's session cookies. Built by `buildIsolationContext`. */
export interface IsolationContext {
  t: TestApp;
  wsA: WorkspaceId;
  userA: { id: string };
  wsB: WorkspaceId;
  userB: { id: string };
  cookiesB: string[];
}

/** A bot with its own credentials, inserted directly: fixtures that need a parent use it. */
async function insertBot(t: TestApp, wsA: WorkspaceId): Promise<string> {
  const credentials = await t.ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', 'Isolation chat'), ($1, 'mock', 'Isolation embed')
     RETURNING id`,
    [wsA],
  );
  const [chat, embed] = credentials.map((row) => row.id);
  const rows = await t.ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Isolation bot', $2, $3, 'mock-chat', $4, 'mock-embed', 384)
     RETURNING id`,
    [
      wsA,
      `pk_live_isolation_${wsA.slice(0, 8)}_${Math.random().toString(36).slice(2, 8)}`,
      chat,
      embed,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insertBot: insert returned no id');
  return id;
}

/**
 * Keyed by route param name (`botId`, `credentialId`, …; `workspaceId` is built in). Each
 * fixture creates the resource in workspace A and returns its id; the suite then requests it
 * as a member of workspace B and expects 404.
 */
export const ISOLATION_FIXTURES: Record<string, (ctx: IsolationContext) => Promise<string>> = {
  /** An agent of workspace A. */
  userId: async ({ t, wsA }) => {
    const { user } = await createUser({ ds: t.ds }, { email: `agent-${wsA}@example.com` });
    await t.ds.query(
      "INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'agent')",
      [wsA, user.id],
    );
    return user.id;
  },
  /** A provider credential of workspace A (the mock provider needs no secret). */
  credentialId: async ({ t, wsA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO provider_credentials (workspace_id, provider, label)
       VALUES ($1, 'mock', 'Isolation') RETURNING id`,
      [wsA],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('credentialId fixture: insert returned no id');
    return id;
  },
  /** A bot of workspace A, with its own chat and embedding credentials in that workspace. */
  botId: async ({ t, wsA }) => insertBot(t, wsA),
  /** A knowledge source of a bot in workspace A. */
  sourceId: async ({ t, wsA }) => {
    const botId = await insertBot(t, wsA);
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title)
       VALUES ($1, $2, 'text', 'Isolation source') RETURNING id`,
      [wsA, botId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('sourceId fixture: insert returned no id');
    return id;
  },
  /** A document (with a version) of a source of workspace A. */
  documentId: async ({ t, wsA }) => {
    const botId = await insertBot(t, wsA);
    const sources = await t.ds.query<{ id: string }[]>(
      `INSERT INTO knowledge_sources (workspace_id, bot_id, type, title)
       VALUES ($1, $2, 'text', 'Isolation source') RETURNING id`,
      [wsA, botId],
    );
    const sourceId = sources[0]?.id;
    if (sourceId === undefined) throw new Error('documentId fixture: source insert failed');
    const documents = await t.ds.query<{ id: string }[]>(
      `INSERT INTO documents (workspace_id, bot_id, source_id, title)
       VALUES ($1, $2, $3, 'Isolation document') RETURNING id`,
      [wsA, botId, sourceId],
    );
    const id = documents[0]?.id;
    if (id === undefined) throw new Error('documentId fixture: insert returned no id');
    return id;
  },
  /** A conversation (with its contact and bot) of workspace A. */
  conversationId: async ({ t, wsA }) => {
    const botId = await insertBot(t, wsA);
    const contacts = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id, email, name)
       VALUES ($1, 'isolation-contact@example.com', 'Isolation contact') RETURNING id`,
      [wsA],
    );
    const contactId = contacts[0]?.id;
    if (contactId === undefined) throw new Error('conversationId fixture: contact insert failed');
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id, status, last_message_at)
       VALUES ($1, $2, $3, 'needs_human', now()) RETURNING id`,
      [wsA, botId, contactId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('conversationId fixture: insert returned no id');
    return id;
  },
  /** An internal note on a conversation in workspace A. */
  noteId: async ({ t, wsA, userA }) => {
    const botId = await insertBot(t, wsA);
    const contacts = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id`,
      [wsA],
    );
    const conversationRows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id, status)
       VALUES ($1, $2, $3, 'needs_human') RETURNING id`,
      [wsA, botId, contacts[0]?.id],
    );
    const conversationId = conversationRows[0]?.id;
    if (conversationId === undefined) throw new Error('noteId fixture: conversation insert failed');
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversation_internal_notes
         (workspace_id, conversation_id, author_user_id, body)
       VALUES ($1, $2, $3, 'Isolation internal note') RETURNING id`,
      [wsA, conversationId, userA.id],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('noteId fixture: insert returned no id');
    return id;
  },
  /** An AI message (with conversation, bot and contact) of workspace A. */
  messageId: async ({ t, wsA }) => {
    const botId = await insertBot(t, wsA);
    const contacts = await t.ds.query<{ id: string }[]>(
      `INSERT INTO contacts (workspace_id) VALUES ($1) RETURNING id`,
      [wsA],
    );
    const conversations = await t.ds.query<{ id: string }[]>(
      `INSERT INTO conversations (workspace_id, bot_id, contact_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [wsA, botId, contacts[0]?.id],
    );
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO messages (workspace_id, conversation_id, role, content)
       VALUES ($1, $2, 'ai', 'Isolation answer') RETURNING id`,
      [wsA, conversations[0]?.id],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('messageId fixture: insert returned no id');
    return id;
  },
  /** A generation trace of workspace A. */
  traceId: async ({ t, wsA }) => {
    const botId = await insertBot(t, wsA);
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO generation_traces
         (workspace_id, bot_id, origin, decision, retrieval)
       VALUES ($1, $2, 'widget', 'answered', '[]'::jsonb) RETURNING id`,
      [wsA, botId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('traceId fixture: insert returned no id');
    return id;
  },
  /** A pending invitation of workspace A. */
  invitationId: async ({ t, wsA, userA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, 'agent', $3, $4, now() + interval '7 days') RETURNING id`,
      [wsA, `invitee-${wsA}@example.com`, sha256Hex(`isolation-${wsA}`), userA.id],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('invitationId fixture: insert returned no id');
    return id;
  },
  /** An API key belonging to workspace A. */
  keyId: async ({ t, wsA, userA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO api_keys
         (workspace_id, name, key_hash, key_prefix, scopes, created_by_user_id)
       VALUES ($1, 'Isolation key', $2, 'ak_live_isolation', $3, $4)
       RETURNING id`,
      [wsA, sha256Hex(`isolation-key-${wsA}`), ['conversations:read'], userA.id],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('keyId fixture: insert returned no id');
    return id;
  },
  /** An integration connection belonging to workspace A. */
  integrationId: async ({ t, wsA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO integrations
         (workspace_id, provider, name, status, scopes, external_account_id,
          transcript_sharing, last_error, disconnected_at)
       VALUES ($1, 'hubspot', 'Isolation CRM', 'active', $2, NULL, false, NULL, NULL)
       RETURNING id`,
      [wsA, ['contacts.read']],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('integrationId fixture: insert returned no id');
    return id;
  },
  /** A webhook belonging to workspace A. */
  webhookId: async ({ t, wsA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO webhooks
         (workspace_id, url, events, status, secret_ciphertext, secret_iv, secret_tag, key_version)
       VALUES ($1, 'https://hooks.example.test/isolation', $2, 'active', $3, $4, $5, 1)
       RETURNING id`,
      [
        wsA,
        ['message.created'],
        Buffer.from('isolation-secret'),
        Buffer.alloc(12),
        Buffer.alloc(16),
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('webhookId fixture: insert returned no id');
    return id;
  },
  /** A webhook delivery belonging to workspace A. */
  deliveryId: async ({ t, wsA }) => {
    const webhookRows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO webhooks
         (workspace_id, url, events, status, secret_ciphertext, secret_iv, secret_tag, key_version)
       VALUES ($1, 'https://hooks.example.test/isolation-delivery', $2, 'active', $3, $4, $5, 1)
       RETURNING id`,
      [
        wsA,
        ['message.created'],
        Buffer.from('isolation-secret'),
        Buffer.alloc(12),
        Buffer.alloc(16),
      ],
    );
    const webhookId = webhookRows[0]?.id;
    if (webhookId === undefined) throw new Error('deliveryId fixture: webhook insert failed');
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO webhook_deliveries
         (workspace_id, webhook_id, event_id, event_type, status, attempt_count)
       VALUES ($1, $2, $3, 'message.created', 'failed', 1)
       RETURNING id`,
      [wsA, webhookId, newId()],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('deliveryId fixture: insert returned no id');
    return id;
  },
  /** A saved reply owned by workspace A. */
  replyId: async ({ t, wsA, userA }) => {
    const rows = await t.ds.query<{ id: string }[]>(
      `INSERT INTO saved_replies
         (workspace_id, title, body, normalized_title, created_by, updated_by)
       VALUES ($1, 'Isolation reply', 'Isolation body', 'isolation reply', $2, $2)
       RETURNING id`,
      [wsA, userA.id],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('replyId fixture: insert returned no id');
    return id;
  },
};

/** Valid non-resource path parameters used to exercise route guards without modeling them as tenant data. */
export const ISOLATION_STATIC_PARAMS: Record<string, string> = {
  provider: 'hubspot',
};

/** Workspace-scoped routes that need no isolation check, each with the reason. */
export const ISOLATION_EXEMPT: { method: string; path: string; reason: string }[] = [];

/**
 * Valid request bodies, keyed by `METHOD /path`, so a request with B's own workspace id reaches
 * the service (instead of failing validation) and the service's tenant check is what answers.
 * `ids` holds the fixture ids of workspace A, including `memberUserId` for body references.
 */
export const ISOLATION_BODIES: Record<string, (ids: Record<string, string>) => unknown> = {
  'PATCH /api/v1/workspaces/:workspaceId': () => ({ name: 'Renamed by B' }),
  'PATCH /api/v1/workspaces/:workspaceId/members/:userId': () => ({ role: 'admin' }),
  'POST /api/v1/workspaces/:workspaceId/invitations': () => ({
    email: 'isolation@example.com',
    role: 'agent',
  }),
  'POST /api/v1/workspaces/:workspaceId/transfer-ownership': (ids) => ({
    userId: ids['userId'],
  }),
  'POST /api/v1/workspaces/:workspaceId/conversations/:conversationId/messages': () => ({
    content: 'Isolation reply',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/conversations/:conversationId/assignment': (ids) => ({
    assignedUserId: ids['userId'],
    expectedWorkflowVersion: 1,
    mutationId: newId(),
  }),
  'PATCH /api/v1/workspaces/:workspaceId/conversations/:conversationId/priority': () => ({
    priority: 'high',
    expectedWorkflowVersion: 1,
    mutationId: newId(),
  }),
  'POST /api/v1/workspaces/:workspaceId/saved-replies': () => ({
    title: 'Isolation reply',
    body: 'Isolation body',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/saved-replies/:replyId': () => ({
    title: 'Changed reply',
    body: 'Changed body',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/saved-replies/order': (ids) => ({
    ids: [ids['replyId']],
  }),
  'POST /api/v1/workspaces/:workspaceId/conversations/:conversationId/agent-assist/suggested-reply':
    () => ({ idempotencyKey: newId() }),
  'POST /api/v1/workspaces/:workspaceId/conversations/:conversationId/internal-notes': () => ({
    body: 'Isolation note from workspace B',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/conversations/:conversationId/internal-notes/:noteId':
    () => ({ body: 'Changed note', expectedVersion: 1 }),
  'DELETE /api/v1/workspaces/:workspaceId/conversations/:conversationId/internal-notes/:noteId':
    () => ({ expectedVersion: 1 }),
  'POST /api/v1/workspaces/:workspaceId/credentials': () => ({
    provider: 'mock',
    label: 'Isolation',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/credentials/:credentialId': () => ({
    label: 'Renamed by B',
  }),
  'POST /api/v1/workspaces/:workspaceId/credentials/:credentialId/test': () => ({}),
  'PUT /api/v1/workspaces/:workspaceId/model-prices': () => ({ prices: [] }),
  'POST /api/v1/workspaces/:workspaceId/bots': (ids) => ({
    name: 'Isolation bot',
    chatCredentialId: ids['credentialId'],
    chatModel: 'mock-chat',
  }),
  'PATCH /api/v1/workspaces/:workspaceId/bots/:botId': () => ({ name: 'Renamed by B' }),
  'POST /api/v1/workspaces/:workspaceId/bots/:botId/prompt-versions': () => ({
    systemPrompt: 'Renamed by B',
  }),
};

/**
 * Routes whose body names a resource of workspace A. They are also called with B's own
 * workspace id, where only the service's tenant check can answer 404.
 */
export const BODY_REFERENCES = new Set([
  'POST /api/v1/workspaces/:workspaceId/transfer-ownership',
  'POST /api/v1/workspaces/:workspaceId/bots',
  'PATCH /api/v1/workspaces/:workspaceId/conversations/:conversationId/assignment',
  'PATCH /api/v1/workspaces/:workspaceId/saved-replies/order',
]);
