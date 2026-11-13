// SPDX-License-Identifier: AGPL-3.0-only
export { widgetCorsPreflight } from './widget-cors';
export { CurrentVisitor } from './current-visitor.decorator';
export { VisitorGuard } from './visitor.guard';
export {
  VISITOR_TOKEN_TTL_DAYS,
  VisitorTokenService,
  type VisitorClaims,
} from './visitor-token.service';
export { CURRENT_VISITOR, type CurrentVisitorData } from './widget-rate-limits';
export { WidgetModule } from './widget.module';
