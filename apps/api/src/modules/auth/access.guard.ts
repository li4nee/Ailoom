// SPDX-License-Identifier: AGPL-3.0-only
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Role } from '@app/shared';

import { RequestContextService } from '../../common/context/request-context';
import { sha256Hex } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { asWorkspaceId } from '../../db/ids';
import { ApiKeysRepository } from '../api-keys/api-keys.repository';
import { AccessRepository } from './access.repository';
import { ACCESS_COOKIE, readCookie } from './cookies';
import {
  INSTANCE_ADMIN_ONLY,
  IS_PUBLIC,
  REQUIRED_API_KEY_SCOPE,
  REQUIRE_VERIFIED_EMAIL,
  REQUIRED_ROLE,
  SESSION_ONLY,
} from './decorators';
import type { Principal } from './principal';
import { TokenService } from './token.service';

/** Higher beats lower, so an owner satisfies `@RequireRole('admin')`. */
const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, agent: 1 };

interface GuardRequest {
  headers: { cookie?: string | string[]; authorization?: string | string[] };
  params?: Record<string, string | undefined>;
  principal?: Principal;
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
    private readonly apiKeys: ApiKeysRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<GuardRequest>();
    const workspaceParam = request.params?.['workspaceId'];
    const workspaceId = workspaceParam === undefined ? null : asWorkspaceId(workspaceParam);
    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const apiKeyToken = /^Bearer\s+(ak_live_[A-Za-z0-9_-]+)$/i.exec(authorization ?? '')?.[1];
    let principal: Principal;

    if (apiKeyToken !== undefined) {
      if (workspaceId === null) throw new AppError('unauthorized');
      const key = await this.apiKeys.findActiveByHash(
        workspaceId,
        sha256Hex(apiKeyToken),
        new Date(),
      );
      if (key === null) throw new AppError('unauthorized');
      principal = {
        userId: key.createdByUserId,
        sessionId: `api-key:${key.id}`,
        isInstanceAdmin: false,
        emailVerified: true,
        authMethod: 'api_key',
        apiKeyId: key.id,
        apiKeyScopes: key.scopes,
        workspace: { id: workspaceId, role: 'admin' },
      };
    } else {
      const token = readCookie(request.headers.cookie, ACCESS_COOKIE);
      if (token === undefined) throw new AppError('unauthorized');
      const claims = await this.tokens.verifyAccess(token);
      const access = await this.access.load(claims.sub, workspaceId);
      if (access === null) throw new AppError('unauthorized');
      if (access.tokenVersion !== claims.tv) throw new AppError('session_revoked');
      if (workspaceId !== null && access.role === null) throw new AppError('not_found');
      principal = {
        userId: claims.sub,
        sessionId: claims.sid,
        isInstanceAdmin: access.isInstanceAdmin,
        emailVerified: access.emailVerified,
        authMethod: 'session',
        apiKeyId: null,
        apiKeyScopes: [],
        workspace:
          workspaceId !== null && access.role !== null
            ? { id: workspaceId, role: access.role }
            : null,
      };
    }

    if (
      this.reflector.getAllAndOverride<boolean>(SESSION_ONLY, targets) &&
      principal.authMethod !== 'session'
    ) {
      throw new AppError('forbidden');
    }
    const requiredScope = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_API_KEY_SCOPE,
      targets,
    );
    if (
      requiredScope !== undefined &&
      principal.authMethod === 'api_key' &&
      !principal.apiKeyScopes.includes(requiredScope)
    ) {
      throw new AppError('forbidden');
    }

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
