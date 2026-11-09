// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { SnakeNamingStrategy } from './naming-strategy';

describe('SnakeNamingStrategy', () => {
  const s = new SnakeNamingStrategy();

  it('snake-cases column names', () => {
    expect(s.columnName('workspaceId', undefined, [])).toBe('workspace_id');
    expect(s.columnName('createdAt', undefined, [])).toBe('created_at');
    expect(s.columnName('name', undefined, [])).toBe('name');
  });

  it('keeps an explicit column name exactly as given', () => {
    expect(s.columnName('x', 'customName', [])).toBe('customName');
  });

  it('prefixes embedded columns with the embedded property path', () => {
    expect(s.columnName('lineOne', undefined, ['billingAddress'])).toBe('billing_address_line_one');
    expect(s.columnName('x', 'custom', ['embedded'])).toBe('embedded_custom');
  });

  it('treats an acronym as one word', () => {
    expect(s.columnName('apiURL', undefined, [])).toBe('api_url');
    expect(s.columnName('URLPath', undefined, [])).toBe('url_path');
  });

  it('snake-cases table names unless one is given', () => {
    expect(s.tableName('ConversationMessage', undefined)).toBe('conversation_message');
    expect(s.tableName('Bot', 'bots')).toBe('bots');
  });

  it('snake-cases relation names', () => {
    expect(s.relationName('knowledgeSource')).toBe('knowledge_source');
  });

  it('names join columns after the relation and the referenced column', () => {
    expect(s.joinColumnName('bot', 'id')).toBe('bot_id');
    expect(s.joinColumnName('knowledgeSource', 'id')).toBe('knowledge_source_id');
  });

  it('names join tables after the two tables', () => {
    expect(s.joinTableName('bots', 'tags')).toBe('bots_tags');
  });

  it('names join table columns after the table and the column', () => {
    expect(s.joinTableColumnName('bots', 'id', undefined)).toBe('bots_id');
    expect(s.joinTableInverseColumnName('tags', 'id', 'tagId')).toBe('tags_tag_id');
  });
});
