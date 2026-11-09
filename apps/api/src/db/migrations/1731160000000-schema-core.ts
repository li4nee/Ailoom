// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SchemaCore1731160000000 implements MigrationInterface {
  name = 'SchemaCore1731160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE provider_kind AS ENUM (
        'openai', 'anthropic', 'gemini', 'groq', 'mistral',
        'ollama', 'openai_compatible', 'local', 'mock'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE source_type AS ENUM (
        'web', 'file', 'github', 'notion', 'confluence', 'google_drive'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE source_status AS ENUM (
        'pending', 'syncing', 'completed', 'failed', 'archived'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE document_status AS ENUM (
        'pending', 'processing', 'completed', 'failed', 'archived'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE conversation_status AS ENUM (
        'ai', 'needs_human', 'human', 'closed'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE channel AS ENUM ('web');
    `);

    await queryRunner.query(`
      CREATE TYPE priority AS ENUM ('low', 'normal', 'high', 'urgent');
    `);

    await queryRunner.query(`
      CREATE TYPE message_role AS ENUM ('system', 'user', 'assistant', 'tool');
    `);

    await queryRunner.query(`
      CREATE TYPE message_status AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');
    `);

    await queryRunner.query(`
      CREATE TYPE trace_decision AS ENUM ('answered', 'escalated', 'refused', 'error');
    `);

    await queryRunner.query(`
      CREATE TYPE trace_origin AS ENUM ('widget', 'playground');
    `);

    await queryRunner.query(`
      CREATE TYPE no_answer_behavior AS ENUM ('handoff', 'retry', 'escalate');
    `);

    // provider_credentials table
    await queryRunner.query(`
      CREATE TABLE provider_credentials (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        provider provider_kind NOT NULL,
        api_key varchar(500),
        base_url varchar(500),
        config jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX provider_credentials_workspace_id_name_key
      ON provider_credentials (workspace_id, name);
    `);

    await queryRunner.query(`
      CREATE INDEX provider_credentials_workspace_id_provider_idx
      ON provider_credentials (workspace_id, provider);
    `);

    // bots table
    await queryRunner.query(`
      CREATE TABLE bots (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        credential_id uuid,
        name varchar(255) NOT NULL,
        system_prompt text,
        temperature int NOT NULL DEFAULT 0,
        max_output_tokens int,
        no_answer_behavior no_answer_behavior NOT NULL DEFAULT 'handoff',
        handoff_message text,
        handoff_phrases varchar(255)[] NOT NULL DEFAULT '{}',
        allowed_link_domains varchar(255)[] NOT NULL DEFAULT '{}',
        allowed_origins varchar(255)[] NOT NULL DEFAULT '{}',
        require_challenge boolean NOT NULL DEFAULT false,
        priority priority NOT NULL DEFAULT 'normal',
        channel channel NOT NULL DEFAULT 'web',
        token_version int NOT NULL DEFAULT 0,
        pending_embedding_model varchar(100),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX bots_workspace_id_name_key
      ON bots (workspace_id, name);
    `);

    await queryRunner.query(`
      CREATE INDEX bots_workspace_id_credential_id_idx
      ON bots (workspace_id, credential_id);
    `);

    // prompt_versions table
    await queryRunner.query(`
      CREATE TABLE prompt_versions (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        bot_id uuid NOT NULL,
        version int NOT NULL,
        system_prompt text NOT NULL,
        temperature int NOT NULL DEFAULT 0,
        max_output_tokens int,
        no_answer_behavior no_answer_behavior NOT NULL DEFAULT 'handoff',
        handoff_message text,
        handoff_phrases varchar(255)[] NOT NULL DEFAULT '{}',
        allowed_link_domains varchar(255)[] NOT NULL DEFAULT '{}',
        allowed_origins varchar(255)[] NOT NULL DEFAULT '{}',
        require_challenge boolean NOT NULL DEFAULT false,
        priority priority NOT NULL DEFAULT 'normal',
        channel channel NOT NULL DEFAULT 'web',
        is_active boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX prompt_versions_bot_id_version_key
      ON prompt_versions (bot_id, version);
    `);

    await queryRunner.query(`
      CREATE INDEX prompt_versions_bot_id_is_active_idx
      ON prompt_versions (bot_id, is_active);
    `);

    // knowledge_sources table
    await queryRunner.query(`
      CREATE TABLE knowledge_sources (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        type source_type NOT NULL,
        config jsonb NOT NULL DEFAULT '{}',
        status source_status NOT NULL DEFAULT 'pending',
        last_error text,
        last_synced_at timestamptz,
        document_count int NOT NULL DEFAULT 0,
        chunk_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX knowledge_sources_workspace_id_name_key
      ON knowledge_sources (workspace_id, name);
    `);

    await queryRunner.query(`
      CREATE INDEX knowledge_sources_workspace_id_type_idx
      ON knowledge_sources (workspace_id, type);
    `);

    // documents table
    await queryRunner.query(`
      CREATE TABLE documents (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        source_id uuid NOT NULL,
        external_id varchar(500) NOT NULL,
        title varchar(500),
        content_hash text,
        status document_status NOT NULL DEFAULT 'pending',
        metadata jsonb NOT NULL DEFAULT '{}',
        last_error text,
        chunk_count int NOT NULL DEFAULT 0,
        token_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX documents_workspace_id_source_id_idx
      ON documents (workspace_id, source_id);
    `);

    await queryRunner.query(`
      CREATE INDEX documents_workspace_id_external_id_idx
      ON documents (workspace_id, external_id);
    `);

    await queryRunner.query(`
      CREATE INDEX documents_workspace_id_status_idx
      ON documents (workspace_id, status);
    `);

    // document_versions table
    await queryRunner.query(`
      CREATE TABLE document_versions (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        document_id uuid NOT NULL,
        version int NOT NULL,
        content_hash text NOT NULL,
        title varchar(500),
        metadata jsonb NOT NULL DEFAULT '{}',
        chunk_count int NOT NULL DEFAULT 0,
        token_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX document_versions_document_id_version_key
      ON document_versions (document_id, version);
    `);

    await queryRunner.query(`
      CREATE INDEX document_versions_workspace_id_document_id_idx
      ON document_versions (workspace_id, document_id);
    `);

    // chunks table
    await queryRunner.query(`
      CREATE TABLE chunks (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        document_id uuid NOT NULL,
        document_version_id uuid NOT NULL,
        chunk_index int NOT NULL,
        content text NOT NULL,
        token_count int NOT NULL,
        embedding text,
        embedding_dim int,
        metadata jsonb NOT NULL DEFAULT '{}',
        tsv tsvector,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX chunks_workspace_id_document_id_idx
      ON chunks (workspace_id, document_id);
    `);

    await queryRunner.query(`
      CREATE INDEX chunks_workspace_id_document_version_id_idx
      ON chunks (workspace_id, document_version_id);
    `);

    await queryRunner.query(`
      CREATE INDEX chunks_workspace_id_embedding_dim_idx
      ON chunks (workspace_id, embedding_dim);
    `);

    // contacts table
    await queryRunner.query(`
      CREATE TABLE contacts (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        email varchar(255),
        name varchar(255),
        external_id varchar(255),
        metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX contacts_workspace_id_email_key
      ON contacts (workspace_id, email)
      WHERE email IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX contacts_workspace_id_external_id_key
      ON contacts (workspace_id, external_id)
      WHERE external_id IS NOT NULL;
    `);

    // conversations table
    await queryRunner.query(`
      CREATE TABLE conversations (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        contact_id uuid NOT NULL,
        bot_id uuid,
        assignee_id uuid,
        status conversation_status NOT NULL DEFAULT 'ai',
        channel channel NOT NULL DEFAULT 'web',
        priority priority NOT NULL DEFAULT 'normal',
        subject text,
        handoff_reason varchar(100),
        handoff_message text,
        last_message_at timestamptz,
        message_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX conversations_workspace_id_contact_id_idx
      ON conversations (workspace_id, contact_id);
    `);

    await queryRunner.query(`
      CREATE INDEX conversations_workspace_id_bot_id_idx
      ON conversations (workspace_id, bot_id);
    `);

    await queryRunner.query(`
      CREATE INDEX conversations_workspace_id_status_idx
      ON conversations (workspace_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX conversations_workspace_id_last_message_at_idx
      ON conversations (workspace_id, last_message_at);
    `);

    // messages table
    await queryRunner.query(`
      CREATE TABLE messages (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        contact_id uuid NOT NULL,
        bot_id uuid,
        user_id uuid,
        role message_role NOT NULL,
        content text NOT NULL,
        tool_calls jsonb NOT NULL DEFAULT '[]',
        metadata jsonb NOT NULL DEFAULT '{}',
        status message_status NOT NULL DEFAULT 'pending',
        trace_decision trace_decision,
        input_tokens int NOT NULL DEFAULT 0,
        output_tokens int NOT NULL DEFAULT 0,
        ttft_ms int NOT NULL DEFAULT 0,
        tsv tsvector,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX messages_workspace_id_conversation_id_idx
      ON messages (workspace_id, conversation_id);
    `);

    await queryRunner.query(`
      CREATE INDEX messages_workspace_id_contact_id_idx
      ON messages (workspace_id, contact_id);
    `);

    await queryRunner.query(`
      CREATE INDEX messages_workspace_id_role_idx
      ON messages (workspace_id, role);
    `);

    await queryRunner.query(`
      CREATE INDEX messages_workspace_id_status_idx
      ON messages (workspace_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX messages_workspace_id_created_at_idx
      ON messages (workspace_id, created_at);
    `);

    // generation_traces table
    await queryRunner.query(`
      CREATE TABLE generation_traces (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        bot_id uuid,
        conversation_id uuid,
        contact_id uuid,
        message_id uuid,
        user_id uuid,
        prompt text NOT NULL,
        completion text,
        model_params jsonb NOT NULL DEFAULT '{}',
        decision trace_decision,
        origin trace_origin NOT NULL,
        input_tokens int NOT NULL DEFAULT 0,
        output_tokens int NOT NULL DEFAULT 0,
        ttft_ms int NOT NULL DEFAULT 0,
        latency_ms int NOT NULL DEFAULT 0,
        error_code text,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX generation_traces_workspace_id_bot_id_idx
      ON generation_traces (workspace_id, bot_id);
    `);

    await queryRunner.query(`
      CREATE INDEX generation_traces_workspace_id_conversation_id_idx
      ON generation_traces (workspace_id, conversation_id);
    `);

    await queryRunner.query(`
      CREATE INDEX generation_traces_workspace_id_decision_idx
      ON generation_traces (workspace_id, decision);
    `);

    await queryRunner.query(`
      CREATE INDEX generation_traces_workspace_id_created_at_idx
      ON generation_traces (workspace_id, created_at);
    `);

    // usage_daily table
    await queryRunner.query(`
      CREATE TABLE usage_daily (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        workspace_id uuid NOT NULL,
        bot_id uuid,
        date date NOT NULL,
        input_tokens bigint NOT NULL DEFAULT 0,
        output_tokens bigint NOT NULL DEFAULT 0,
        embedding_tokens bigint NOT NULL DEFAULT 0,
        request_count bigint NOT NULL DEFAULT 0,
        error_count bigint NOT NULL DEFAULT 0
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX usage_daily_workspace_id_date_key
      ON usage_daily (workspace_id, date);
    `);

    await queryRunner.query(`
      CREATE INDEX usage_daily_workspace_id_bot_id_date_idx
      ON usage_daily (workspace_id, bot_id, date);
    `);

    // model_prices table
    await queryRunner.query(`
      CREATE TABLE model_prices (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        provider provider_kind NOT NULL,
        model varchar(255) NOT NULL,
        workspace_id uuid,
        input_price_per_1k numeric(18,6) NOT NULL DEFAULT 0,
        output_price_per_1k numeric(18,6) NOT NULL DEFAULT 0,
        embedding_price_per_1k numeric(18,6) NOT NULL DEFAULT 0,
        currency varchar(10) NOT NULL DEFAULT 'USD'
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX model_prices_provider_model_workspace_id_key
      ON model_prices (provider, model, workspace_id);
    `);

    // Foreign keys
    await queryRunner.query(`
      ALTER TABLE bots
      ADD CONSTRAINT bots_credential_id_fkey
      FOREIGN KEY (credential_id) REFERENCES provider_credentials (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE prompt_versions
      ADD CONSTRAINT prompt_versions_bot_id_fkey
      FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE documents
      ADD CONSTRAINT documents_source_id_fkey
      FOREIGN KEY (source_id) REFERENCES knowledge_sources (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE document_versions
      ADD CONSTRAINT document_versions_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE chunks
      ADD CONSTRAINT chunks_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE chunks
      ADD CONSTRAINT chunks_document_version_id_fkey
      FOREIGN KEY (document_version_id) REFERENCES document_versions (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE conversations
      ADD CONSTRAINT conversations_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE conversations
      ADD CONSTRAINT conversations_bot_id_fkey
      FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE messages
      ADD CONSTRAINT messages_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE messages
      ADD CONSTRAINT messages_bot_id_fkey
      FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE generation_traces
      ADD CONSTRAINT generation_traces_bot_id_fkey
      FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE generation_traces
      ADD CONSTRAINT generation_traces_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE generation_traces
      ADD CONSTRAINT generation_traces_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE generation_traces
      ADD CONSTRAINT generation_traces_message_id_fkey
      FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE usage_daily
      ADD CONSTRAINT usage_daily_bot_id_fkey
      FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    await queryRunner.query(
      `ALTER TABLE usage_daily DROP CONSTRAINT IF EXISTS usage_daily_bot_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE generation_traces DROP CONSTRAINT IF EXISTS generation_traces_message_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE generation_traces DROP CONSTRAINT IF EXISTS generation_traces_contact_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE generation_traces DROP CONSTRAINT IF EXISTS generation_traces_conversation_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE generation_traces DROP CONSTRAINT IF EXISTS generation_traces_bot_id_fkey;`,
    );
    await queryRunner.query(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_bot_id_fkey;`);
    await queryRunner.query(
      `ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_contact_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_bot_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_document_version_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_document_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_document_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_id_fkey;`,
    );
    await queryRunner.query(
      `ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_versions_bot_id_fkey;`,
    );
    await queryRunner.query(`ALTER TABLE bots DROP CONSTRAINT IF EXISTS bots_credential_id_fkey;`);

    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS model_prices;`);
    await queryRunner.query(`DROP TABLE IF EXISTS usage_daily;`);
    await queryRunner.query(`DROP TABLE IF EXISTS generation_traces;`);
    await queryRunner.query(`DROP TABLE IF EXISTS messages;`);
    await queryRunner.query(`DROP TABLE IF EXISTS conversations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS contacts;`);
    await queryRunner.query(`DROP TABLE IF EXISTS chunks;`);
    await queryRunner.query(`DROP TABLE IF EXISTS document_versions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS documents;`);
    await queryRunner.query(`DROP TABLE IF EXISTS knowledge_sources;`);
    await queryRunner.query(`DROP TABLE IF EXISTS prompt_versions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS bots;`);
    await queryRunner.query(`DROP TABLE IF EXISTS provider_credentials;`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS no_answer_behavior;`);
    await queryRunner.query(`DROP TYPE IF EXISTS trace_origin;`);
    await queryRunner.query(`DROP TYPE IF EXISTS trace_decision;`);
    await queryRunner.query(`DROP TYPE IF EXISTS message_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS message_role;`);
    await queryRunner.query(`DROP TYPE IF EXISTS priority;`);
    await queryRunner.query(`DROP TYPE IF EXISTS channel;`);
    await queryRunner.query(`DROP TYPE IF EXISTS conversation_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS document_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS source_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS source_type;`);
    await queryRunner.query(`DROP TYPE IF EXISTS provider_kind;`);
  }
}
