// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every user-facing string in the admin. Components never inline copy, so wording changes in
 * one place and a later translation has a single source.
 */
import { account } from './strings/account';
import { app } from './strings/app';
import { audit } from './strings/audit';
import { auth } from './strings/auth';
import { bots } from './strings/bots';
import { conversations } from './strings/conversations';
import { credentials } from './strings/credentials';
import { evalStrings } from './strings/eval';
import { instance } from './strings/instance';
import { integrations } from './strings/integrations';
import { invite } from './strings/invite';
import { knowledge } from './strings/knowledge';
import { members } from './strings/members';
import { nav } from './strings/nav';
import { notifications } from './strings/notifications';
import { playground } from './strings/playground';
import { roles } from './strings/roles';
import { savedReplies } from './strings/savedReplies';
import { tools } from './strings/tools';
import { usage } from './strings/usage';
import { webhooks } from './strings/webhooks';
import { workspaces } from './strings/workspaces';

export const strings = {
  app,
  auth,
  invite,
  roles,
  bots,
  playground,
  knowledge,
  credentials,
  eval: evalStrings,
  integrations,
  webhooks,
  conversations,
  savedReplies,
  usage,
  tools,
  nav,
  notifications,
  workspaces,
  members,
  account,
  instance,
  audit,
} as const;
