// SPDX-License-Identifier: AGPL-3.0-only
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { AppError } from '../../common/errors';
import { type CurrentVisitorData, CURRENT_VISITOR } from './widget-rate-limits';

/** What the visitor guard stores the resolved visitor under. */
interface VisitorRequest {
  [CURRENT_VISITOR]?: CurrentVisitorData;
}

/** Injects the `{ claims, bot }` the visitor guard resolved for this request. */
export const CurrentVisitor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentVisitorData => {
    const request = context.switchToHttp().getRequest<VisitorRequest>();
    if (request[CURRENT_VISITOR] === undefined) throw new AppError('unauthorized');
    return request[CURRENT_VISITOR];
  },
);
