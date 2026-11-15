// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import { AppError } from '../../common/errors';
import { BotsRepository, matchesAllowedOrigin, type BotEntity } from '../bots';
import { VisitorTokenService, type VisitorClaims } from './visitor-token.service';
import { CURRENT_VISITOR, type PublicVisitorData } from './widget-rate-limits';

/** Widget routes live under the global `/api` prefix (spec §17.9). */
const WIDGET_PREFIX = '/api/widget/';

interface WidgetRequest extends IncomingMessage {
  url?: string;
  body?: unknown;
  [CURRENT_VISITOR]?: PublicVisitorData;
}

function bearerTokenOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // RFC 7235: the auth-scheme is case-insensitive, and runs of spaces are allowed.
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match?.[1] ?? null;
}

function publicKeyOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const key = (body as { publicKey?: unknown }).publicKey;
  return typeof key === 'string' && key !== '' ? key : null;
}

/** The `k` query param the widget sends on `GET /api/widget/v1/challenge`. */
function challengeKeyOf(url: string): string | null {
  try {
    return new URL(url, 'http://localhost').searchParams.get('k') ?? null;
  } catch {
    return null;
  }
}

/**
 * The hostile-web armor in front of every widget route (spec §10.4): resolves the bot — from
 * the visitor token, or from the `publicKey` in the body on the session-create shape —
 * requires bot and workspace to be alive, and requires the page's `Origin` to be allowed.
 * Success marks the response CORS-readable and stores `{ claims, bot }` for the handlers and
 * the rate limiter; the origin failure carries no ACAO header, so a browser never reads it.
 *
 * Runs as a global guard before `RateLimitGuard`, whose widget trackers read the visitor.
 */
@Injectable()
export class VisitorGuard implements CanActivate {
  constructor(
    private readonly tokens: VisitorTokenService,
    private readonly bots: BotsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WidgetRequest>();
    const url = request.url ?? '';
    if (!url.startsWith(WIDGET_PREFIX)) return true;

    const header = request.headers.origin;
    const origin = typeof header === 'string' ? header : null;

    const token = bearerTokenOf(request.headers.authorization);
    const resolution = token !== null ? await this.byToken(token) : await this.byPublicKey(request);
    if (resolution.bot === null) throw new AppError('bot_not_found');
    if (origin === null || !matchesAllowedOrigin(origin, resolution.bot.allowedOrigins)) {
      throw new AppError('origin_not_allowed');
    }

    const response = context.switchToHttp().getResponse<ServerResponse>();
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    request[CURRENT_VISITOR] = { claims: resolution.claims, bot: resolution.bot };
    return true;
  }

  /** The token route: verify, then load the live bot the claims bind (same workspace). */
  private async byToken(token: string): Promise<Resolution> {
    const claims = await this.tokens.verify(token);
    return { claims, bot: await this.bots.findLiveForVisitor(claims.workspaceId, claims.botId) };
  }

  /** The session-create shape: the public key in the body, or the `k` query param on the
   * challenge shape. No visitor yet. */
  private async byPublicKey(request: WidgetRequest): Promise<Resolution> {
    const publicKey = publicKeyOf(request.body) ?? challengeKeyOf(request.url ?? '');
    if (publicKey === null) throw new AppError('unauthorized');
    return { claims: null, bot: await this.bots.findLiveByPublicKey(publicKey) };
  }
}

/** What the guard resolves: a live bot, plus the visitor claims when a token was presented. */
interface Resolution {
  claims: VisitorClaims | null;
  bot: BotEntity | null;
}
