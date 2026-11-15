// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

/**
 * Open visitor event streams in this API process (spec §17.9). The widget keeps one stream per
 * conversation while its tab is open; an agent-reply email is only sent when that count is zero
 * at the time the debounced job runs.
 */
@Injectable()
export class VisitorPresence {
  private readonly connections = new Map<string, number>();

  /** Records an open stream and returns the matching disconnect function. */
  connect(conversationId: string): () => void {
    this.connections.set(conversationId, (this.connections.get(conversationId) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = (this.connections.get(conversationId) ?? 1) - 1;
      if (current <= 0) this.connections.delete(conversationId);
      else this.connections.set(conversationId, current);
    };
  }

  isConnected(conversationId: string): boolean {
    return (this.connections.get(conversationId) ?? 0) > 0;
  }
}
