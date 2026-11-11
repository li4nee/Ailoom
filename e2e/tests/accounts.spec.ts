// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';

import { expect, extractLink, test } from '../fixtures';

const OWNER = { email: 'owner@acme.test', password: 'lighthouse kettle 2026' };
const AGENT = { email: 'agent@acme.test', password: 'marble orchard 2026' };

async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();
}

async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('owner sets up a workspace, invites an agent, and logs out everywhere', async ({
  browser,
  page,
  mailpit,
}) => {
  // The first visitor signs up and becomes the instance's first user.
  await page.goto('/signup');
  await expect(page.getByText(/You are the first user/)).toBeVisible();
  await signUp(page, OWNER.email, OWNER.password);

  // The verification email arrives and its link verifies the address.
  const verify = await mailpit.lastEmailTo(OWNER.email, /verify/i);
  await page.goto(extractLink(verify.text, '/verify-email'));
  await expect(page.getByText('Your email address is verified.')).toBeVisible();

  // No workspace yet: logging in lands on the create page.
  await logIn(page, OWNER.email, OWNER.password);
  await expect(page).toHaveURL(/\/new-workspace$/);
  await page.getByLabel('Workspace name').fill('Acme');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: 'Switch workspace' })).toContainText('Acme');
  const workspaceUrl = page.url();

  // Invite the agent.
  await page.goto(`${workspaceUrl}/settings/invitations`);
  await page.getByLabel('Email').fill(AGENT.email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByLabel('Invitation link')).toHaveValue(/\/invitations\/accept\?token=/);

  // The agent signs up through the invitation link in a separate browser context.
  const agentContext = await browser.newContext();
  const agent = await agentContext.newPage();
  const invitation = await mailpit.lastEmailTo(AGENT.email, /invit/i);
  await agent.goto(extractLink(invitation.text, '/invitations/accept'));
  await expect(agent.getByText('You are invited to Acme as agent.')).toBeVisible();
  await agent.getByRole('link', { name: 'Sign up to accept' }).click();
  await signUp(agent, AGENT.email, AGENT.password);
  await logIn(agent, AGENT.email, AGENT.password);
  await expect(agent.getByRole('button', { name: 'Switch workspace' })).toContainText('Acme');

  // Agents get no member management: an admins-only notice, and no controls or admin tabs.
  await agent.goto(`${new URL(agent.url()).pathname}/settings/members`);
  await expect(agent.getByText('Only admins can see and manage the member list.')).toBeVisible();
  await expect(agent.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(agent.getByRole('link', { name: 'Members' })).toHaveCount(0);
  await expect(agent.getByRole('link', { name: 'Invitations' })).toHaveCount(0);
  await expect(agent.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
  await agentContext.close();

  // The owner is also signed in on a second device.
  const otherContext = await browser.newContext();
  const otherDevice = await otherContext.newPage();
  await logIn(otherDevice, OWNER.email, OWNER.password);
  await expect(otherDevice).toHaveURL(/\/w\//);

  // Logging out everywhere from the first device...
  await page.goto('/account/sessions');
  await page.getByRole('button', { name: 'Log out everywhere' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Log out everywhere' }).click();
  await expect(page).toHaveURL(/\/login/);

  // ...sends the other device to the login page on its next navigation.
  await otherDevice.goto('/account');
  await expect(otherDevice).toHaveURL(/\/login\?next=/);
  await otherContext.close();
});
