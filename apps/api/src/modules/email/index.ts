// SPDX-License-Identifier: AGPL-3.0-only
export { ResendMailer } from './resend.mailer';
export { SmtpMailer } from './smtp.mailer';
export { LogMailer, type InfoLogSink } from './log.mailer';
export { MemoryMailer } from './memory.mailer';
export { MAILER, type Mailer, type MailMessage } from './mailer';
export { EMAIL_SEND_JOB, EmailService } from './email.service';
export { EmailProcessor } from './email.processor';
export { EmailModule, type EmailModuleOptions } from './email.module';
export {
  EMAIL_TEMPLATE_NAMES,
  type EmailTemplateName,
  type RenderedEmail,
  type TemplateContext,
  type TemplateData,
  renderTemplate,
  siteLink,
} from './templates';
