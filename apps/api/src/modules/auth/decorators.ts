// SPDX-License-Identifier: AGPL-3.0-only
import {
  createParamDecorator,
  type CustomDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

import type { ApiKeyScope, Role } from '@app/shared';

import { AppError } from '../../common/errors';
import type { Principal } from './principal';

export const IS_PUBLIC = 'auth:is-public';
export const REQUIRED_ROLE = 'auth:required-role';
export const INSTANCE_ADMIN_ONLY = 'auth:instance-admin-only';
export const REQUIRE_VERIFIED_EMAIL = 'auth:require-verified-email';
export const SESSION_ONLY = 'auth:session-only';
export const REQUIRED_API_KEY_SCOPE = 'auth:required-api-key-scope';

/** Skips the access guard. Use only for routes that must work before authentication. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC, true);

/** Requires at least `role` in the route's workspace; owner satisfies admin, admin satisfies agent. */
export const RequireRole = (role: Role): CustomDecorator => SetMetadata(REQUIRED_ROLE, role);

/** Requires `users.is_instance_admin`; independent of any workspace role. */
export const InstanceAdminOnly = (): CustomDecorator => SetMetadata(INSTANCE_ADMIN_ONLY, true);

/** Rejects a user who has not confirmed their email address. */
export const RequireVerifiedEmail = (): CustomDecorator =>
  SetMetadata(REQUIRE_VERIFIED_EMAIL, true);

/** Rejects machine credentials; used for API-key lifecycle and browser-only settings routes. */
export const SessionOnly = (): CustomDecorator => SetMetadata(SESSION_ONLY, true);

/** Requires this scope only when the request is authenticated by a workspace API key. */
export const RequireApiKeyScope = (scope: ApiKeyScope): CustomDecorator =>
  SetMetadata(REQUIRED_API_KEY_SCOPE, scope);

interface PrincipalRequest {
  principal?: Principal;
}

/** Injects the principal the access guard stored on the request. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    if (request.principal === undefined) throw new AppError('unauthorized');
    return request.principal;
  },
);
