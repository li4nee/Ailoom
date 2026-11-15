// SPDX-License-Identifier: AGPL-3.0-only
import { type z } from 'zod';

import { assertNever } from '../../../common/assert-never';
import { AppError } from '../../../common/errors';
import { agentReplyDataSchema, renderAgentReply, type AgentReplyData } from './agent-reply';
import {
  handoffRequestedDataSchema,
  renderHandoffRequested,
  type HandoffRequestedData,
} from './handoff-requested';
import { renderInvitation, invitationDataSchema, type InvitationData } from './invitation';
import {
  emailDocument,
  escapeHtml,
  html,
  siteLink,
  type RenderedEmail,
  type TemplateContext,
} from './layout';
import {
  renderResetPassword,
  resetPasswordDataSchema,
  type ResetPasswordData,
} from './reset-password';
import {
  renderSecurityAlert,
  securityAlertDataSchema,
  type SecurityAlertData,
} from './security-alert';
import { renderSpendAlert, spendAlertDataSchema, type SpendAlertData } from './spend-alert';
import { renderVerifyEmail, verifyEmailDataSchema, type VerifyEmailData } from './verify-email';

export { emailDocument, escapeHtml, html, siteLink, type RenderedEmail, type TemplateContext };

/** Every transactional email the product sends, in the order milestones add them. */
export const EMAIL_TEMPLATE_NAMES = [
  'verify_email',
  'reset_password',
  'invitation',
  'security_alert',
  'spend_alert',
  'handoff_requested',
  'agent_reply',
] as const;

export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

/** The data each template needs; a type alias so it also satisfies `Record<string, unknown>`. */
export interface TemplateData {
  verify_email: VerifyEmailData;
  reset_password: ResetPasswordData;
  invitation: InvitationData;
  security_alert: SecurityAlertData;
  spend_alert: SpendAlertData;
  handoff_requested: HandoffRequestedData;
  agent_reply: AgentReplyData;
}

function parseData<S extends z.ZodType>(
  schema: S,
  name: EmailTemplateName,
  data: unknown,
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError('internal_error', {
      message: `Email template ${name} received invalid data.`,
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Renders a template with compile-time checked data, or from untrusted data (the second
 * overload) after validating it against the template's schema.
 */
export function renderTemplate<N extends EmailTemplateName>(
  name: N,
  data: TemplateData[N],
  ctx: TemplateContext,
): RenderedEmail;
export function renderTemplate(
  name: EmailTemplateName,
  data: unknown,
  ctx: TemplateContext,
): RenderedEmail;
export function renderTemplate(
  name: EmailTemplateName,
  data: unknown,
  ctx: TemplateContext,
): RenderedEmail {
  switch (name) {
    case 'verify_email':
      return renderVerifyEmail(parseData(verifyEmailDataSchema, name, data), ctx);
    case 'reset_password':
      return renderResetPassword(parseData(resetPasswordDataSchema, name, data), ctx);
    case 'invitation':
      return renderInvitation(parseData(invitationDataSchema, name, data), ctx);
    case 'security_alert':
      return renderSecurityAlert(parseData(securityAlertDataSchema, name, data), ctx);
    case 'spend_alert':
      return renderSpendAlert(parseData(spendAlertDataSchema, name, data), ctx);
    case 'handoff_requested':
      return renderHandoffRequested(parseData(handoffRequestedDataSchema, name, data), ctx);
    case 'agent_reply':
      return renderAgentReply(parseData(agentReplyDataSchema, name, data), ctx);
    default:
      return assertNever(name);
  }
}
