// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

/**
 * The in-flight answer streams of this API process (spec §14.3). An agent action aborts the
 * stream for its conversation, so the visitor stops receiving AI tokens immediately. This is
 * intentionally in-process: an answer is served by the process that started it, and the agent
 * action that aborts it runs in the same API deployment.
 */
@Injectable()
export class ActiveStreams {
  private readonly streams = new Map<string, Set<AbortController>>();

  /** Registers `controller` for `conversationId`; the returned function removes it. */
  register(conversationId: string, controller: AbortController): () => void {
    let controllers = this.streams.get(conversationId);
    if (controllers === undefined) {
      controllers = new Set();
      this.streams.set(conversationId, controllers);
    }
    controllers.add(controller);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.streams.get(conversationId);
      if (current === undefined) return;
      current.delete(controller);
      if (current.size === 0) this.streams.delete(conversationId);
    };
  }

  /** Aborts every stream of the conversation and reports whether there was one. */
  abort(conversationId: string): boolean {
    const controllers = this.streams.get(conversationId);
    if (controllers === undefined || controllers.size === 0) return false;
    for (const controller of controllers) controller.abort();
    this.streams.delete(conversationId);
    return true;
  }

  /** Number of streams currently registered, for tests and diagnostics. */
  count(conversationId: string): number {
    return this.streams.get(conversationId)?.size ?? 0;
  }
}
