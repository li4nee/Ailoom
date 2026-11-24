// SPDX-License-Identifier: AGPL-3.0-only
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DataSource } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser, createWorkspace } from '../../../test/helpers/factories';
import { FixedClock } from '../../common/clock';
import { RequestContextService } from '../../common/context/request-context';
import { asWorkspaceId, type UserId, type WorkspaceId } from '../../db/ids';
import { AuditRepository } from '../audit/audit.repository';
import { AuditService } from '../audit/audit.service';
import { MembershipsRepository } from '../workspaces/memberships.repository';
import { KnowledgeSuggestionEntity } from './entities/knowledge-suggestion.entity';
import { type SourcesService } from './sources.service';
import { SUGGESTION_CREATED } from './suggestions.events';
import { SuggestionsRepository } from './suggestions.repository';
import { SuggestionsService } from './suggestions.service';

const NOW = new Date('2026-11-24T09:00:00.000Z');

let ds: DataSource;
let service: SuggestionsService;
let events: EventEmitter2;
let workspaceId: WorkspaceId;
let otherWorkspaceId: WorkspaceId;
let ownerId: string;
let agentId: string;
let botId: string;
let conversationId: string;
let aiMessageId: string;

async function createBot(workspace: WorkspaceId, suffix: string): Promise<string> {
  const credentials = await ds.query<{ id: string }[]>(
    `INSERT INTO provider_credentials (workspace_id, provider, label)
     VALUES ($1, 'mock', $2), ($1, 'mock', $3) RETURNING id`,
    [workspace, `Chat ${suffix}`, `Embed ${suffix}`],
  );
  const rows = await ds.query<{ id: string }[]>(
    `INSERT INTO bots (workspace_id, name, public_key, chat_credential_id, chat_model,
                       embedding_credential_id, embedding_model, embedding_dim)
     VALUES ($1, 'Support bot', $2, $3, 'mock-chat', $4, 'mock-embed', 384) RETURNING id`,
    [
      workspace,
      `pk_suggestion_${suffix}_${String(Date.now())}`,
      credentials[0]?.id,
      credentials[1]?.id,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('bot insert returned no id');
  return id;
}

async function createConversation(status: 'ai' | 'closed' = 'ai'): Promise<void> {
  const contact = await ds.query<{ id: string }[]>(
    `INSERT INTO contacts (workspace_id, name) VALUES ($1, 'Visitor') RETURNING id`,
    [workspaceId],
  );
  const conversation = await ds.query<{ id: string }[]>(
    `INSERT INTO conversations (workspace_id, bot_id, contact_id, status, created_at, last_message_at)
     VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [workspaceId, botId, contact[0]?.id, status, NOW],
  );
  const id = conversation[0]?.id;
  if (id === undefined) throw new Error('conversation insert returned no id');
  conversationId = id;
  const messages = await ds.query<{ id: string; role: string }[]>(
    `INSERT INTO messages (workspace_id, conversation_id, role, content, status, created_at)
     VALUES ($1, $2, 'visitor', '  How do I reset my password?  ', 'complete', $3),
            ($1, $2, 'ai', 'Use the reset link.', 'complete', $4)
     RETURNING id, role`,
    [workspaceId, id, new Date(NOW.getTime() - 1000), NOW],
  );
  aiMessageId = messages.find((message) => message.role === 'ai')?.id ?? '';
}

beforeAll(async () => {
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await resetDatabase(ds);
  const { user: owner } = await createUser(
    { ds },
    { email: 'suggestions-owner@example.com', name: 'Owner' },
  );
  const { user: agent } = await createUser(
    { ds },
    { email: 'suggestions-agent@example.com', name: 'Agent' },
  );
  const { user: otherOwner } = await createUser(
    { ds },
    { email: 'suggestions-other@example.com', name: 'Other owner' },
  );
  workspaceId = asWorkspaceId((await createWorkspace({ ds }, owner, 'Suggestions')).id);
  otherWorkspaceId = asWorkspaceId((await createWorkspace({ ds }, otherOwner, 'Other')).id);
  ownerId = owner.id;
  agentId = agent.id;
  await new MembershipsRepository(ds).insert(workspaceId, agentId, 'agent');
  botId = await createBot(workspaceId, 'primary');
  await createConversation();
  events = new EventEmitter2();
  service = new SuggestionsService(
    ds,
    new SuggestionsRepository(ds),
    {} as SourcesService,
    new MembershipsRepository(ds),
    new FixedClock(NOW),
    events,
    new AuditService(new AuditRepository(ds), new RequestContextService()),
  );
});

describe('SuggestionsService.review', () => {
  it('records an incorrect answer, creates a pending suggestion, audits it and emits the M13 event', async () => {
    const emitted = vi.fn();
    events.on(SUGGESTION_CREATED, emitted);
    const result = await service.review(
      workspaceId,
      conversationId,
      aiMessageId,
      agentId as UserId,
      {
        verdict: 'incorrect',
        question: 'How do I reset my password?',
        answer: 'Open Settings and select Reset password.',
      },
    );

    expect(result.review).toMatchObject({
      verdict: 'incorrect',
      correctedAnswer: 'Open Settings and select Reset password.',
      reviewerId: agentId,
      reviewedAt: NOW.toISOString(),
    });
    expect(result.suggestion).toMatchObject({
      botId,
      botName: 'Support bot',
      messageId: aiMessageId,
      conversationId,
      question: 'How do I reset my password?',
      status: 'pending',
      createdBy: { id: agentId, name: 'Agent' },
    });
    expect(result.review.suggestionId).toBe(result.suggestion?.id);
    const stored = await ds.getRepository(KnowledgeSuggestionEntity).findOneByOrFail({
      workspaceId,
      messageId: aiMessageId,
    });
    expect(stored.answer).toBe('Open Settings and select Reset password.');
    const message = await ds.query<{ agent_review: unknown }[]>(
      `SELECT agent_review FROM messages WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, aiMessageId],
    );
    expect(message[0]?.agent_review).toMatchObject({
      verdict: 'incorrect',
      suggestionId: stored.id,
    });
    expect(emitted).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, suggestionId: stored.id, botId, conversationId }),
    );
    const audit = await new AuditService(new AuditRepository(ds), new RequestContextService()).list(
      workspaceId,
      { limit: 10 },
    );
    expect(audit.data[0]).toMatchObject({
      actorUserId: agentId,
      action: 'knowledge.agent_answer_reviewed',
      targetId: aiMessageId,
      metadata: { verdict: 'incorrect', conversationId, suggestionId: stored.id },
    });
    const outbox = await ds.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM integration_events WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(outbox[0]?.count).toBe(0);
  });

  it('replaces a pending suggestion on re-review and stores a correct review without a suggestion', async () => {
    const first = await service.review(
      workspaceId,
      conversationId,
      aiMessageId,
      agentId as UserId,
      {
        verdict: 'incorrect',
        question: 'Question one',
        answer: 'Answer one',
      },
    );
    const second = await service.review(
      workspaceId,
      conversationId,
      aiMessageId,
      ownerId as UserId,
      {
        verdict: 'incorrect',
        question: 'Question edited',
        answer: 'Answer edited',
      },
    );
    expect(second.suggestion?.id).toBe(first.suggestion?.id);
    expect(second.suggestion).toMatchObject({
      question: 'Question edited',
      answer: 'Answer edited',
    });

    const correct = await service.review(
      workspaceId,
      conversationId,
      aiMessageId,
      agentId as UserId,
      {
        verdict: 'correct',
      },
    );
    expect(correct).toMatchObject({
      review: { verdict: 'correct', correctedAnswer: null, suggestionId: null },
      suggestion: null,
    });
    expect(await ds.getRepository(KnowledgeSuggestionEntity).countBy({ workspaceId })).toBe(0);
  });

  it('rejects streaming, errored and non-AI messages with conflict', async () => {
    const input = { verdict: 'correct' } as const;
    await ds.query(`UPDATE messages SET status = 'streaming' WHERE id = $1`, [aiMessageId]);
    await expect(
      service.review(workspaceId, conversationId, aiMessageId, agentId as UserId, input),
    ).rejects.toMatchObject({ code: 'conflict' });
    await ds.query(`UPDATE messages SET status = 'error' WHERE id = $1`, [aiMessageId]);
    await expect(
      service.review(workspaceId, conversationId, aiMessageId, agentId as UserId, input),
    ).rejects.toMatchObject({ code: 'conflict' });
    await ds.query(`UPDATE messages SET role = 'agent', status = 'complete' WHERE id = $1`, [
      aiMessageId,
    ]);
    await expect(
      service.review(workspaceId, conversationId, aiMessageId, agentId as UserId, input),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('returns not_found for a foreign conversation', async () => {
    await expect(
      service.review(otherWorkspaceId, conversationId, aiMessageId, ownerId as UserId, {
        verdict: 'correct',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
