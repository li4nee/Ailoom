// SPDX-License-Identifier: AGPL-3.0-only
export const invite = {
  title: 'Workspace invitation',
  summary: (workspace: string, role: string) => `You are invited to ${workspace} as ${role}.`,
  sentTo: (email: string) => `The invitation was sent to ${email}.`,
  accept: 'Accept invitation',
  signUpToAccept: 'Sign up to accept',
  logInToAccept: 'Log in to accept',
  expired: 'This invitation has expired. Ask for a new one.',
  invalid: 'This invitation is invalid or was already used.',
  wrongAccount: 'This invitation was sent to a different email address.',
  verifyFirst: 'Verify your email address before accepting the invitation.',
} as const;
