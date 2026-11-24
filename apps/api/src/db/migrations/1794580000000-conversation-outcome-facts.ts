// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep the small per-conversation facts needed by the 92-day outcomes report current. */
export class ConversationOutcomeFacts1794580000000 implements MigrationInterface {
  name = 'ConversationOutcomeFacts1794580000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations"
         ADD "outcome_has_visitor_message" boolean NOT NULL DEFAULT false,
         ADD "outcome_has_complete_ai_answer" boolean NOT NULL DEFAULT false,
         ADD "outcome_has_ai_downvote" boolean NOT NULL DEFAULT false,
         ADD "outcome_first_agent_reply_at" timestamptz,
         ADD "outcome_trace_cost_usd" numeric(18,6) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE conversations c
          SET outcome_has_visitor_message = EXISTS (
                SELECT 1 FROM messages m WHERE m.workspace_id = c.workspace_id
                  AND m.conversation_id = c.id AND m.role = 'visitor'
              ),
              outcome_has_complete_ai_answer = EXISTS (
                SELECT 1 FROM messages m WHERE m.workspace_id = c.workspace_id
                  AND m.conversation_id = c.id AND m.role = 'ai' AND m.status = 'complete'
              ),
              outcome_has_ai_downvote = EXISTS (
                SELECT 1 FROM messages m WHERE m.workspace_id = c.workspace_id
                  AND m.conversation_id = c.id AND m.role = 'ai' AND m.feedback = -1
              ),
              outcome_first_agent_reply_at = CASE WHEN c.handoff_requested_at IS NULL THEN NULL ELSE (
                SELECT min(m.created_at) FROM messages m WHERE m.workspace_id = c.workspace_id
                  AND m.conversation_id = c.id AND m.role = 'agent'
                  AND m.created_at >= c.handoff_requested_at
              ) END,
              outcome_trace_cost_usd = coalesce((
                SELECT sum(t.cost_usd) FROM generation_traces t
                 WHERE t.workspace_id = c.workspace_id AND t.conversation_id = c.id
              ), 0)`,
    );

    await queryRunner.query(`
      CREATE FUNCTION maintain_conversation_outcome_from_message() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE conversations c
           SET outcome_has_visitor_message = c.outcome_has_visitor_message OR NEW.role = 'visitor',
               outcome_has_complete_ai_answer = c.outcome_has_complete_ai_answer
                 OR (NEW.role = 'ai' AND NEW.status = 'complete'),
               outcome_has_ai_downvote = CASE WHEN TG_OP = 'UPDATE' THEN EXISTS (
                 SELECT 1 FROM messages m WHERE m.workspace_id = NEW.workspace_id
                   AND m.conversation_id = NEW.conversation_id
                   AND m.role = 'ai' AND m.feedback = -1
               ) ELSE c.outcome_has_ai_downvote
                 OR coalesce(NEW.role = 'ai' AND NEW.feedback = -1, false) END,
               outcome_first_agent_reply_at = CASE
                 WHEN NEW.role = 'agent' AND c.handoff_requested_at IS NOT NULL
                   AND NEW.created_at >= c.handoff_requested_at
                 THEN least(coalesce(c.outcome_first_agent_reply_at, NEW.created_at), NEW.created_at)
                 ELSE c.outcome_first_agent_reply_at END
         WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.conversation_id;
        RETURN NEW;
      END;
      $$`);
    await queryRunner.query(`
      CREATE TRIGGER "messages_conversation_outcome_insert"
      AFTER INSERT ON "messages" FOR EACH ROW
      EXECUTE FUNCTION maintain_conversation_outcome_from_message()`);
    await queryRunner.query(`
      CREATE TRIGGER "messages_conversation_outcome_update"
      AFTER UPDATE OF role, status, feedback, created_at ON "messages" FOR EACH ROW
      EXECUTE FUNCTION maintain_conversation_outcome_from_message()`);

    await queryRunner.query(`
      CREATE FUNCTION maintain_conversation_outcome_handoff() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.handoff_requested_at IS NOT NULL THEN
          UPDATE conversations c
             SET outcome_first_agent_reply_at = (
               SELECT min(m.created_at) FROM messages m
                WHERE m.workspace_id = NEW.workspace_id AND m.conversation_id = NEW.id
                  AND m.role = 'agent' AND m.created_at >= NEW.handoff_requested_at
             )
           WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.id;
        END IF;
        RETURN NEW;
      END;
      $$`);
    await queryRunner.query(`
      CREATE TRIGGER "conversations_outcome_handoff"
      AFTER UPDATE OF handoff_requested_at ON "conversations" FOR EACH ROW
      WHEN (OLD.handoff_requested_at IS DISTINCT FROM NEW.handoff_requested_at)
      EXECUTE FUNCTION maintain_conversation_outcome_handoff()`);

    await queryRunner.query(`
      CREATE FUNCTION maintain_conversation_outcome_trace() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP <> 'INSERT' AND OLD.conversation_id IS NOT NULL THEN
          UPDATE conversations c
             SET outcome_trace_cost_usd = c.outcome_trace_cost_usd - OLD.cost_usd
           WHERE c.workspace_id = OLD.workspace_id AND c.id = OLD.conversation_id;
        END IF;
        IF TG_OP <> 'DELETE' AND NEW.conversation_id IS NOT NULL THEN
          UPDATE conversations c
             SET outcome_trace_cost_usd = c.outcome_trace_cost_usd + NEW.cost_usd
           WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.conversation_id;
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$`);
    for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      await queryRunner.query(`
        CREATE TRIGGER "generation_traces_conversation_outcome_${event.toLowerCase()}"
        AFTER ${event} ON "generation_traces" FOR EACH ROW
        EXECUTE FUNCTION maintain_conversation_outcome_trace()`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "generation_traces_conversation_outcome_delete" ON "generation_traces"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "generation_traces_conversation_outcome_update" ON "generation_traces"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "generation_traces_conversation_outcome_insert" ON "generation_traces"`,
    );
    await queryRunner.query(`DROP FUNCTION maintain_conversation_outcome_trace()`);
    await queryRunner.query(`DROP TRIGGER "conversations_outcome_handoff" ON "conversations"`);
    await queryRunner.query(`DROP FUNCTION maintain_conversation_outcome_handoff()`);
    await queryRunner.query(`DROP TRIGGER "messages_conversation_outcome_update" ON "messages"`);
    await queryRunner.query(`DROP TRIGGER "messages_conversation_outcome_insert" ON "messages"`);
    await queryRunner.query(`DROP FUNCTION maintain_conversation_outcome_from_message()`);
    await queryRunner.query(
      `ALTER TABLE "conversations"
         DROP COLUMN "outcome_trace_cost_usd",
         DROP COLUMN "outcome_first_agent_reply_at",
         DROP COLUMN "outcome_has_ai_downvote",
         DROP COLUMN "outcome_has_complete_ai_answer",
         DROP COLUMN "outcome_has_visitor_message"`,
    );
  }
}
