// SPDX-License-Identifier: AGPL-3.0-only
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Role } from '@app/shared';

import { RequestContextService } from '../../common/context/request-context';
import { AppError } from '../../common/errors';
import { asWorkspaceId } from '../../db/ids';
import { AccessRepository } from './access.repository';
import {
  INSTANCE_ADMIN_ONLY,
  IS_PUBLIC,
  REQUIRE_VERIFIED_EMAIL,
  REQUIRED_ROLE,
} from './decorators';
import type { Principal } from './principal';
import { TokenService } from './token.service';

const ACCESS_COOKIE = '__Host-at';

/** Higher beats lower, so an owner satisfies `@RequireRole('admin')`. */
const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, agent: 1 };

interface GuardRequest {
  headers: { cookie?: string | string[] };
  params?: Record<string, string | undefined>;
  principal?: Principal;
}

function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  const text = Array.isArray(header) ? header.join(';') : header;
  for (const part of text.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

/**
 * Authenticates and authorizes every request that is not `@Public` (spec §10.1). Identity
 * comes from the access JWT; the live role, instance-admin flag and token version come from
 * one database query, so revocations and demotions apply immediately.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly access: AccessRepository,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const token = readCookie(request.headers.cookie, ACCESS_COOKIE);
    if (token === undefined) throw new AppError('unauthorized');

    const claims = await this.tokens.verifyAccess(token);
    // A malformed workspace id cannot exist, so it answers exactly like a missing workspace.
    const workspaceParam = request.params?.['workspaceId'];
    const workspaceId = workspaceParam === undefined ? null : asWorkspaceId(workspaceParam);

    const access = await this.access.load(claims.sub, workspaceId);
    if (access === null) throw new AppError('unauthorized');
    if (access.tokenVersion !== claims.tv) throw new AppError('session_revoked');
    if (workspaceId !== null && access.role === null) throw new AppError('not_found');

    const principal: Principal = {
      userId: claims.sub,
      sessionId: claims.sid,
      isInstanceAdmin: access.isInstanceAdmin,
      emailVerified: access.emailVerified,
      workspace:
        workspaceId !== null && access.role !== null
          ? { id: workspaceId, role: access.role }
          : null,
    };

    const requiredRole = this.reflector.getAllAndOverride<Role | undefined>(REQUIRED_ROLE, targets);
    if (requiredRole !== undefined) {
      if (
        principal.workspace === null ||
        ROLE_RANK[principal.workspace.role] < ROLE_RANK[requiredRole]
      ) {
        throw new AppError('forbidden');
      }
    }
    if (
      this.reflector.getAllAndOverride<boolean>(INSTANCE_ADMIN_ONLY, targets) &&
      !principal.isInstanceAdmin
    ) {
      throw new AppError('forbidden');
    }
    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL, targets) &&
      !principal.emailVerified
    ) {
      throw new AppError('email_not_verified');
    }

    request.principal = principal;
    this.context.update(
      workspaceId === null
        ? { userId: principal.userId }
        : { userId: principal.userId, workspaceId },
    );
    return true;
  }
}
