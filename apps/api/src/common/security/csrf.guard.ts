// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config';
import { AppError } from '../errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type CsrfRequest = IncomingMessage;

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Spec §10.1: a mutating `/api/v1` request must come from the admin app, proven by
 * `X-Requested-With: fetch` and an `Origin` matching `PUBLIC_URL`. SameSite cookies alone do
 * not cover older browsers or non-browser clients.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CsrfRequest>();
    if (SAFE_METHODS.has(request.method ?? 'GET')) return true;
    if (!(request.url ?? '').startsWith('/api/v1/')) return true;

    if (request.headers['x-requested-with'] !== 'fetch') throw new AppError('csrf_failed');
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || originOf(origin) !== this.config.publicUrl.origin) {
      throw new AppError('csrf_failed');
    }
    return true;
  }
}
