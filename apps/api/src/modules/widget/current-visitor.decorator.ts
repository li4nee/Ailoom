// SPDX-License-Identifier: AGPL-3.0-only
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { AppError } from '../../common/errors';
import {
  type PublicVisitorData,
  type CurrentVisitorData,
  CURRENT_VISITOR,
} from './widget-rate-limits';

/** What the visitor guard stores the resolved visitor under. */
interface VisitorRequest {
  [CURRENT_VISITOR]?: PublicVisitorData;
}

function visitorOf(context: ExecutionContext): PublicVisitorData {
  const request = context.switchToHttp().getRequest<VisitorRequest>();
  const visitor = request[CURRENT_VISITOR];
  if (visitor === undefined) throw new AppError('unauthorized');
  return visitor;
}

/**
 * Injects the authenticated visitor the guard resolved. A route that accepts a public key
 * instead (session create, challenge) uses `PublicVisitor`; reaching this decorator without a
 * visitor token is an authorization failure rather than a null claims value in the handler.
 */
export const CurrentVisitor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentVisitorData => {
    const visitor = visitorOf(context);
    if (visitor.claims === null) throw new AppError('unauthorized');
    return { claims: visitor.claims, bot: visitor.bot };
  },
);

/** Injects the bot for routes a visitor may call before it has a token. */
export const PublicVisitor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicVisitorData => visitorOf(context),
);
