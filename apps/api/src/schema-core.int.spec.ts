// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { getTestDataSource } from '../test/helpers/db';

describe('schema-core', () => {
  const expectedTables = [
    'provider_credentials',
    'bots',
    'prompt_versions',
    'knowledge_sources',
    'documents',
    'document_versions',
    'chunks',
    'contacts',
    'conversations',
    'messages',
    'generation_traces',
    'usage_daily',
    'model_prices',
  ];

  const expectedEnums = [
    'provider_kind',
    'source_type',
    'source_status',
    'document_status',
    'conversation_status',
    'channel',
    'priority',
    'message_role',
    'message_status',
    'trace_decision',
    'trace_origin',
    'no_answer_behavior',
  ];

  it('creates all expected tables', async () => {
    const ds = await getTestDataSource();
    const tables = await ds.query<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tableNames = tables.map((t: { tablename: string }) => t.tablename);
    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  it('creates all expected enum types', async () => {
    const ds = await getTestDataSource();
    const enums = await ds.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname`,
    );
    const enumNames = enums.map((e: { typname: string }) => e.typname);
    for (const expected of expectedEnums) {
      expect(enumNames).toContain(expected);
    }
  });

  it('uses uuidv7() as default for all primary keys', async () => {
    const ds = await getTestDataSource();
    const result = await ds.query<{ table_name: string; column_default: string }[]>(
      `SELECT table_name, column_default
         FROM information_schema.columns
        WHERE column_default LIKE '%uuidv7%'
        ORDER BY table_name`,
    );
    const tablesWithUuidv7 = new Set(result.map((r: { table_name: string }) => r.table_name));
    for (const expected of expectedTables) {
      expect(tablesWithUuidv7).toContain(expected);
    }
  });

  it('creates expected indexes', async () => {
    const ds = await getTestDataSource();
    const indexes = await ds.query<{ indexname: string; tablename: string }[]>(
      `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`,
    );
    const expectedIndexes = [
      'provider_credentials_workspace_id_name_key',
      'provider_credentials_workspace_id_provider_idx',
      'bots_workspace_id_name_key',
      'bots_workspace_id_credential_id_idx',
      'prompt_versions_bot_id_version_key',
      'prompt_versions_bot_id_is_active_idx',
      'knowledge_sources_workspace_id_name_key',
      'knowledge_sources_workspace_id_type_idx',
      'documents_workspace_id_source_id_idx',
      'documents_workspace_id_external_id_idx',
      'documents_workspace_id_status_idx',
      'document_versions_document_id_version_key',
      'document_versions_workspace_id_document_id_idx',
      'chunks_workspace_id_document_id_idx',
      'chunks_workspace_id_document_version_id_idx',
      'chunks_workspace_id_embedding_dim_idx',
      'chunks_embedding_hnsw_idx',
      'chunks_tsv_gin_idx',
      'contacts_workspace_id_email_key',
      'contacts_workspace_id_external_id_key',
      'conversations_workspace_id_contact_id_idx',
      'conversations_workspace_id_bot_id_idx',
      'conversations_workspace_id_status_idx',
      'conversations_workspace_id_last_message_at_idx',
      'messages_workspace_id_conversation_id_idx',
      'messages_workspace_id_contact_id_idx',
      'messages_workspace_id_role_idx',
      'messages_workspace_id_status_idx',
      'messages_workspace_id_created_at_idx',
      'messages_tsv_gin_idx',
      'generation_traces_workspace_id_bot_id_idx',
      'generation_traces_workspace_id_conversation_id_idx',
      'generation_traces_workspace_id_decision_idx',
      'generation_traces_workspace_id_created_at_idx',
      'usage_daily_workspace_id_date_key',
      'usage_daily_workspace_id_bot_id_date_idx',
      'model_prices_provider_model_workspace_id_key',
    ];
    const indexNames = new Set(indexes.map((i: { indexname: string }) => i.indexname));
    for (const expected of expectedIndexes) {
      expect(indexNames).toContain(expected);
    }
  });

  it('creates foreign key constraints', async () => {
    const ds = await getTestDataSource();
    const fks = await ds.query<{ constraint_name: string; table_name: string }[]>(
      `SELECT conname AS constraint_name, relname AS table_name
         FROM pg_constraint
         JOIN pg_class ON conrelid = oid
        WHERE contype = 'f'
         ORDER BY relname, conname`,
    );
    const expectedFks = [
      'bots_credential_id_fkey',
      'prompt_versions_bot_id_fkey',
      'documents_source_id_fkey',
      'document_versions_document_id_fkey',
      'chunks_document_id_fkey',
      'chunks_document_version_id_fkey',
      'conversations_contact_id_fkey',
      'conversations_bot_id_fkey',
      'messages_conversation_id_fkey',
      'messages_contact_id_fkey',
      'messages_bot_id_fkey',
      'generation_traces_bot_id_fkey',
      'generation_traces_conversation_id_fkey',
      'generation_traces_contact_id_fkey',
      'generation_traces_message_id_fkey',
      'usage_daily_bot_id_fkey',
    ];
    const fkNames = new Set(fks.map((f: { constraint_name: string }) => f.constraint_name));
    for (const expected of expectedFks) {
      expect(fkNames).toContain(expected);
    }
  });

  it('has HNSW index on chunks.embedding', async () => {
    const ds = await getTestDataSource();
    const result = await ds.query<{ amname: string }[]>(
      `SELECT am.amname
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_am am ON am.oid = c.relam
        WHERE c.relname = 'chunks_embedding_hnsw_idx'`,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.amname).toBe('hnsw');
  });

  it('has GIN indexes on tsv columns', async () => {
    const ds = await getTestDataSource();
    const result = await ds.query<{ indexname: string; tablename: string }[]>(
      `SELECT indexname, tablename FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname LIKE '%tsv_gin%'`,
    );
    const tables = new Set(result.map((r: { tablename: string }) => r.tablename));
    expect(tables).toContain('chunks');
    expect(tables).toContain('messages');
  });
});
