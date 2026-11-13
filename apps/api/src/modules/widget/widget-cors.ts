// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The preflight answer for every widget route (spec §17.9): a connect middleware, mounted next
 * to the security headers in `create-http-app.ts`, because the OPTIONS request must never
 * reach the router — Nest would answer `not_found` before any CORS headers exist.
 *
 * The origin is echoed, not checked: preflight carries no bot identity, and a preflight
 * without credentials exposes nothing. The real request enforces the origin (`VisitorGuard`),
 * and its failure response carries no ACAO header, so the browser stops there.
 */
const WIDGET_PREFIX = '/api/widget/';

const ALLOW_METHODS = 'GET, POST';
const ALLOW_HEADERS = 'Authorization, Content-Type, Last-Event-ID';
const MAX_AGE_SECONDS = 600;

export type ConnectMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export function widgetCorsPreflight(): ConnectMiddleware {
  return (request, response, next) => {
    if (request.method !== 'OPTIONS' || !(request.url ?? '').startsWith(WIDGET_PREFIX)) {
      next();
      return;
    }
    const origin = request.headers.origin;
    response.statusCode = 204;
    response.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    response.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    response.setHeader('Access-Control-Max-Age', String(MAX_AGE_SECONDS));
    response.setHeader('Vary', 'Origin');
    if (typeof origin === 'string' && origin !== '') {
      response.setHeader('Access-Control-Allow-Origin', origin);
    }
    response.end();
  };
}
