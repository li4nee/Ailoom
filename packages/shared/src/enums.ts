// SPDX-License-Identifier: MIT

/** Workspace roles, most privileged first. Also the labels of the Postgres `role` enum. */
export const ROLES = ['owner', 'admin', 'agent'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an invitation can grant: ownership is never handed out by invitation. */
export const INVITATION_ROLES = ['admin', 'agent'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/** Purposes of a single-use email token. Also the labels of the Postgres `email_token_type` enum. */
export const EMAIL_TOKEN_TYPES = ['verify_email', 'reset_password'] as const;
export type EmailTokenType = (typeof EMAIL_TOKEN_TYPES)[number];
