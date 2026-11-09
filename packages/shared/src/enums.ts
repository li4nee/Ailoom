// SPDX-License-Identifier: MIT
export enum Role {
  Owner = 'owner',
  Admin = 'admin',
  Agent = 'agent',
}

export enum InvitationRole {
  Admin = 'admin',
  Agent = 'agent',
}

export enum EmailTokenType {
  VerifyEmail = 'verify_email',
  ResetPassword = 'reset_password',
}
