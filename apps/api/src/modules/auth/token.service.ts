// SPDX-License-Identifier: AGPL-3.0-only
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { asUserId, isUuid, type UserId } from '../../db/ids';

/** Claims of an access token; deliberately no roles or workspace ids (spec §10.1). */
export interface AccessClaims {
  sub: UserId;
  sid: string;
  tv: number;
  iat: number;
  exp: number;
}

const claimsSchema = z.object({
  sub: z.string(),
  sid: z.string().min(1),
  tv: z.number().int().nonnegative(),
  iat: z.number().int(),
  exp: z.number().int(),
});

/**
 * Signs and verifies the short-lived HS256 access token. `AUTH_SECRET` is a rotation list:
 * the first secret signs, every secret verifies, so a secret can be replaced without
 * invalidating the tokens issued just before the switch.
 */
@Injectable()
export class TokenService {
  /** jose is ESM-only and the api compiles to CommonJS: load it once, lazily. */
  private joseModule: Promise<typeof import('jose')> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async issueAccess(params: {
    userId: UserId;
    sessionId: string;
    tokenVersion: number;
  }): Promise<string> {
    const { SignJWT } = await this.jose();
    const [signingKey] = this.config.auth.secrets;
    if (signingKey === undefined) {
      throw new AppError('internal_error', { message: 'AUTH_SECRET has no signing key.' });
    }
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ sid: params.sessionId, tv: params.tokenVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(params.userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.config.auth.accessTokenTtlMin * 60)
      .sign(signingKey);
  }

  /**
   * `allowExpired` is for logout only: an idle tab whose access token has expired must still be
   * able to end its own session. jose checks the signature before the claims, so a JWTExpired
   * error still proves the token was signed by us.
   */
  async verifyAccess(jwt: string, options: { allowExpired?: boolean } = {}): Promise<AccessClaims> {
    const { jwtVerify, decodeJwt, errors } = await this.jose();
    for (const secret of this.config.auth.secrets) {
      try {
        const { payload } = await jwtVerify(jwt, secret, {
          algorithms: ['HS256'],
          currentDate: this.clock.now(),
        });
        return toClaims(payload);
      } catch (error) {
        // A valid signature with an expired exp is a distinct answer; every other failure
        // only means "not signed by this key", so the next secret gets a turn.
        if (error instanceof errors.JWTExpired) {
          if (options.allowExpired === true) return toClaims(decodeJwt(jwt));
          throw new AppError('token_expired', { cause: error });
        }
        if (error instanceof AppError) throw error;
      }
    }
    throw new AppError('unauthorized');
  }

  private jose(): Promise<typeof import('jose')> {
    this.joseModule ??= import('jose');
    return this.joseModule;
  }
}

function toClaims(payload: unknown): AccessClaims {
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success || !isUuid(parsed.data.sub)) {
    throw new AppError('unauthorized', { cause: parsed.success ? undefined : parsed.error });
  }
  return {
    sub: asUserId(parsed.data.sub),
    sid: parsed.data.sid,
    tv: parsed.data.tv,
    iat: parsed.data.iat,
    exp: parsed.data.exp,
  };
}
