// SPDX-License-Identifier: AGPL-3.0-only
import type { CustomDecorator, ExecutionContext } from '@nestjs/common';
import { Injectable, SetMetadata } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AppError } from '../errors';
import { clientIp, type IpRequest } from './client-ip';

export type RateLimitName =
  'login' | 'signup' | 'forgot' | 'password' | 'admin' | 'widgetSession' | 'visitorMessage';

export const RATE_LIMIT = 'security:rate-limit';

/** Names the policy for this route; `forgot` is applied by Task 1.8's recovery routes. */
export const RateLimit = (name: RateLimitName): CustomDecorator => SetMetadata(RATE_LIMIT, name);

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function requestedName(context: ExecutionContext): RateLimitName | undefined {
  const handler: unknown = Reflect.getMetadata(RATE_LIMIT, context.getHandler());
  if (typeof handler === 'string') return handler as RateLimitName;
  const controller: unknown = Reflect.getMetadata(RATE_LIMIT, context.getClass());
  return typeof controller === 'string' ? (controller as RateLimitName) : undefined;
}

function only(name: RateLimitName): (context: ExecutionContext) => boolean {
  return (context) => requestedName(context) !== name;
}

function emailOf(request: unknown): string {
  if (typeof request !== 'object' || request === null) return '';
  const body = (request as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) return '';
  const email = (body as { email?: unknown }).email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function userIdOf(request: unknown): string {
  if (typeof request !== 'object' || request === null) return '';
  const principal = (request as { principal?: unknown }).principal;
  if (typeof principal !== 'object' || principal === null) return '';
  const id = (principal as { userId?: unknown }).userId;
  return typeof id === 'string' ? id : '';
}

function ipOf(request: unknown): string {
  return clientIp(request as IpRequest);
}

/**
 * The visitor the widget guard resolved on this request (`widget-rate-limits.ts` owns the
 * contract). `src/common` must stay a leaf, so the shape is read structurally here.
 */
interface WidgetVisitorRequest {
  currentVisitor?: { claims?: { contactId?: unknown }; bot?: { id?: unknown } };
}

/**
 * The widget rate limits key on what the guard resolved. The guard runs before this guard, so
 * a missing key means the wiring skipped the guard: fail loudly rather than bucket everything
 * under one key.
 */
function contactIdOf(request: unknown): string {
  const contactId = (request as WidgetVisitorRequest).currentVisitor?.claims?.contactId;
  if (typeof contactId !== 'string') {
    throw new Error('visitorMessage rate limit: the visitor guard did not resolve a visitor');
  }
  return contactId;
}

function botIdOf(request: unknown): string {
  const botId = (request as WidgetVisitorRequest).currentVisitor?.bot?.id;
  if (typeof botId !== 'string') {
    throw new Error('botMessages rate limit: the visitor guard did not resolve a bot');
  }
  return botId;
}

function visitorTrackerOf(request: unknown): string {
  return `visitor:${contactIdOf(request)}`;
}

function botTrackerOf(request: unknown): string {
  return `bot:${botIdOf(request)}`;
}

function isAuthenticatedV1(context: ExecutionContext): boolean {
  const request: unknown = context.switchToHttp().getRequest();
  const url =
    typeof request === 'object' && request !== null
      ? ((request as { url?: unknown }).url ?? '')
      : '';
  return typeof url === 'string' && url.startsWith('/api/v1/') && userIdOf(request).length > 0;
}

/**
 * Named policies (spec §10.1): login and signup are the unauthenticated attack surface, and a
 * generous per-user cap covers everything else. In-memory storage: a single API instance only
 * (the documented limitation until a shared store is measured as necessary).
 */
export function rateLimitOptions(): ThrottlerModuleOptions {
  const policies: ThrottlerOptions[] = [
    {
      name: 'login',
      ttl: 15 * MINUTE_MS,
      limit: 10,
      skipIf: only('login'),
      getTracker: (request) => `${ipOf(request)}:${emailOf(request)}`,
    },
    {
      name: 'signup',
      ttl: HOUR_MS,
      limit: 5,
      skipIf: only('signup'),
      getTracker: (request) => ipOf(request),
    },
    {
      name: 'forgot',
      ttl: HOUR_MS,
      limit: 5,
      skipIf: only('forgot'),
      getTracker: (request) => ipOf(request),
    },
    {
      // Signed-in routes that check the current password (account deletion, password change):
      // a stolen session cookie must not allow unlimited guesses. Keyed by user, after auth.
      // The throttler counts per route, so each of those routes gets its own 10.
      name: 'password',
      ttl: 15 * MINUTE_MS,
      limit: 10,
      skipIf: only('password'),
      getTracker: (request) => `${userIdOf(request)}:${ipOf(request)}`,
    },
    {
      name: 'admin',
      ttl: MINUTE_MS,
      limit: 600,
      skipIf: (context) => requestedName(context) !== undefined || !isAuthenticatedV1(context),
      getTracker: (request) => userIdOf(request),
    },
    // Spec §20.4 widget limits. The visitor guard runs before this guard (http-app.module),
    // so the message policies can key on the visitor it resolved.
    {
      name: 'widgetSession',
      ttl: HOUR_MS,
      limit: 30,
      skipIf: only('widgetSession'),
      getTracker: (request) => ipOf(request),
    },
    {
      name: 'visitorMessage',
      ttl: MINUTE_MS,
      limit: 20,
      skipIf: only('visitorMessage'),
      getTracker: (request) => visitorTrackerOf(request),
    },
    {
      // The daily half of the `visitorMessage` policy. One named throttler carries one window,
      // so the second window is a second named entry activated by the same route name.
      name: 'visitorMessageDay',
      ttl: DAY_MS,
      limit: 200,
      skipIf: only('visitorMessage'),
      getTracker: (request) => visitorTrackerOf(request),
    },
    {
      // Visitor messages count against the bot as well (§20.4: 600/min); a separate name and
      // bucket next to the per-contact windows on the same routes.
      name: 'botMessages',
      ttl: MINUTE_MS,
      limit: 600,
      skipIf: only('visitorMessage'),
      getTracker: (request) => botTrackerOf(request),
    },
  ];
  return policies;
}

/** Maps a throttled request to the shared `rate_limited` envelope plus `Retry-After`. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<never> {
    const response = context.switchToHttp().getResponse<NodeResponse>();
    const seconds = Math.max(1, Math.ceil(Math.max(detail.timeToBlockExpire, detail.timeToExpire)));
    response.setHeader('Retry-After', String(seconds));
    return Promise.reject(new AppError('rate_limited'));
  }
}
