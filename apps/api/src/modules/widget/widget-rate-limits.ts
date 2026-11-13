// SPDX-License-Identifier: AGPL-3.0-only
import type { BotEntity } from '../bots';
import type { VisitorClaims } from './visitor-token.service';

/**
 * Spec §20.4 widget rate limits: session create 30/hour per IP, visitor messages 20/min and
 * 200/day per contact, and 600/min of visitor messages per bot. The throttler policies are
 * registered in `rateLimitOptions()` (`src/common/security/rate-limit.ts`) — one place builds
 * every named throttler — and they key their buckets on what `VisitorGuard` resolves.
 *
 * `src/common` must stay a leaf, so the common side reads this contract structurally: the
 * request property name and shape here and in the trackers there must stay in step (the
 * widget e2e suite covers it).
 */

/** The request property `VisitorGuard` stores the resolved visitor under. */
export const CURRENT_VISITOR = 'currentVisitor';

/** What the visitor guard puts on the request; `claims` is null until a token is presented. */
export interface CurrentVisitorData {
  claims: VisitorClaims | null;
  bot: BotEntity;
}
