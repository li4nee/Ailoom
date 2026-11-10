// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';

import { Global, Injectable, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

/** Ambient request fields written to the CLS store for the lifetime of one request. */
export interface RequestContext {
  requestId: string;
  /** The client address resolved from the trusted proxy hop. */
  ip?: string;
  workspaceId?: string;
  userId?: string;
  botId?: string;
  conversationId?: string;
  jobId?: string;
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 24;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** A fresh `req_` id: 24 base62 characters (≈143 bits). */
export function newRequestId(): string {
  let body = '';
  while (body.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH)) {
      // Reject 248..255 so every character is uniformly distributed over the 62 symbols.
      if (byte < 248) body += ALPHABET.charAt(byte % ALPHABET.length);
      if (body.length === ID_LENGTH) break;
    }
  }
  return `req_${body}`;
}

/** True when a client-supplied `X-Request-Id` is safe to echo back. */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Read and extend the current request's context; outside a request every getter is undefined. */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService) {}

  get(): RequestContext | undefined {
    return this.cls.get<RequestContext>();
  }

  requestId(): string | undefined {
    return this.get()?.requestId;
  }

  ip(): string | undefined {
    return this.get()?.ip;
  }

  update(patch: Partial<RequestContext>): void {
    for (const [key, value] of Object.entries(patch) as [string, unknown][]) {
      if (value !== undefined) this.cls.set(key, value);
    }
  }
}

/**
 * Global so any feature module can read the request context without importing the HTTP app
 * module (which would close a module cycle).
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class RequestContextModule {}
