// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import {
  asBotId,
  asContactId,
  asWorkspaceId,
  isUuid,
  type BotId,
  type ContactId,
  type WorkspaceId,
} from '../../db/ids';

/** Visitor token lifetime: 30 days (spec §10.4). */
export const VISITOR_TOKEN_TTL_DAYS = 30;

/** Claims of a widget visitor token; every id in the token is server-checked on use. */
export interface VisitorClaims {
  contactId: ContactId;
  botId: BotId;
  workspaceId: WorkspaceId;
}

const claimsSchema = z.object({
  sub: z.string(),
  bot: z.string(),
  ws: z.string(),
});

/**
 * Signs and verifies the visitor JWT that authenticates every widget request. One secret,
 * `WIDGET_SECRET`; admin tokens (`AUTH_SECRET`) are a different key and never verify here.
 */
@Injectable()
export class VisitorTokenService {
  /** jose is ESM-only and the api compiles to CommonJS: load it once, lazily. */
  private joseModule: Promise<typeof import('jose')> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async issue(claims: VisitorClaims): Promise<string> {
    const { SignJWT } = await this.jose();
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ bot: claims.botId, ws: claims.workspaceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('widget')
      .setSubject(claims.contactId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + VISITOR_TOKEN_TTL_DAYS * 24 * 60 * 60)
      .sign(this.config.widgetSecret);
  }

  /** Any failure — signature, audience, expiry, shape — is a flat `unauthorized`. */
  async verify(token: string): Promise<VisitorClaims> {
    const { jwtVerify } = await this.jose();
    try {
      const { payload } = await jwtVerify(token, this.config.widgetSecret, {
        algorithms: ['HS256'],
        audience: 'widget',
        currentDate: this.clock.now(),
      });
      const parsed = claimsSchema.safeParse(payload);
      if (
        !parsed.success ||
        !isUuid(parsed.data.sub) ||
        !isUuid(parsed.data.bot) ||
        !isUuid(parsed.data.ws)
      ) {
        throw new AppError('unauthorized', { cause: parsed.success ? undefined : parsed.error });
      }
      return {
        contactId: asContactId(parsed.data.sub),
        botId: asBotId(parsed.data.bot),
        workspaceId: asWorkspaceId(parsed.data.ws),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('unauthorized', { cause: error });
    }
  }

  private jose(): Promise<typeof import('jose')> {
    this.joseModule ??= import('jose');
    return this.joseModule;
  }
}
