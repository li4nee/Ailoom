// SPDX-License-Identifier: AGPL-3.0-only
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';

import { expect, extractLink, test } from '../fixtures';
import { mailpit } from '../mailpit';
import { BASE_URL } from '../stack';

const API = '/api/v1';
const HOST = 'http://shop.localhost:8090';
const OWNER = { email: 'owner@acme.test', password: 'lighthouse kettle 2026' };
const FAQ =
  'Refunds are processed within five business days. Contact support with your order number to start a return.';

interface Created {
  id: string;
  publicKey?: string;
}

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${response.url()} answered ${String(response.status())}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** The first test user exists after the account spec; when run alone, create and verify it. */
async function authenticate(api: APIRequestContext): Promise<void> {
  const login = await api.post(`${API}/auth/login`, { data: OWNER });
  if (login.ok()) return;

  await json(
    await api.post(`${API}/auth/signup`, {
      data: { ...OWNER, name: 'Handoff Owner' },
    }),
  );
  const email = await mailpit.lastEmailTo(OWNER.email, /verify/i);
  const token = new URL(extractLink(email.text, '/verify-email')).searchParams.get('token');
  if (token === null) throw new Error('the verification link has no token');
  await json(await api.post(`${API}/auth/verify-email`, { data: { token } }));
  await json(await api.post(`${API}/auth/login`, { data: OWNER }));
}

async function seed(api: APIRequestContext): Promise<{
  workspaceId: string;
  publicKey: string;
  base: string;
  botId: string;
}> {
  await authenticate(api);

  const workspace = await json<Created>(
    await api.post(`${API}/workspaces`, { data: { name: 'Handoff E2E' } }),
  );
  const base = `${API}/workspaces/${workspace.id}`;

  // The handoff notification goes to the workspace's configured inbox.
  await json(await api.patch(base, { data: { settings: { notificationEmails: [OWNER.email] } } }));

  const credential = await json<Created>(
    await api.post(`${base}/credentials`, { data: { provider: 'mock', label: 'Mock' } }),
  );
  const bot = await json<Created>(
    await api.post(`${base}/bots`, {
      data: {
        name: 'Support',
        chatCredentialId: credential.id,
        chatModel: 'mock-chat',
        embeddingCredentialId: credential.id,
        embeddingModel: 'mock-embed',
        allowedOrigins: [HOST],
        noAnswerBehavior: 'offer_handoff',
        handoffEnabled: true,
        // The mock embedding is hash-based, not semantic: keep retrieval deterministic once
        // the FAQ exists. Before that there are no chunks, so the first question escalates.
        retrievalThreshold: 0,
      },
    }),
  );
  if (bot.publicKey === undefined) throw new Error('the bot has no public key');
  await json(
    await api.patch(`${base}/bots/${bot.id}`, {
      data: { agentAssistEnabled: true, suggestedRepliesEnabled: true },
    }),
  );
  await json(
    await api.post(`${base}/saved-replies`, {
      data: { title: 'Return follow-up', body: 'I can help start your return.' },
    }),
  );

  // Deliberately no knowledge yet: the first question must escalate for lack of content.
  return { workspaceId: workspace.id, publicKey: bot.publicKey, base, botId: bot.id };
}

/** Adds the FAQ after hand-back and waits until the answer can cite it. */
async function addKnowledge(api: APIRequestContext, base: string, botId: string): Promise<void> {
  await json<Created>(
    await api.post(`${base}/bots/${botId}/sources`, {
      data: { type: 'text', title: 'Refund policy', body: FAQ },
    }),
  );
  await expect
    .poll(
      async () => {
        const retrieval = await json<{ results: { title: string; used: boolean }[] }>(
          await api.post(`${base}/bots/${botId}/test-retrieval`, {
            data: { query: FAQ },
          }),
        );
        return retrieval.results.some((result) => result.used && result.title === 'Refund policy');
      },
      { timeout: 120_000, message: 'the seeded chunk becomes searchable' },
    )
    .toBe(true);
}

async function logIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/w\//);
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Type your message…' });
}

async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('a visitor hands off, an agent replies, hands back, and the next answer is inspectable', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const api = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: BASE_URL, 'X-Requested-With': 'fetch' },
  });
  const seeded = await seed(api);

  // The visitor starts a fresh conversation on the host page.
  const booted = page.waitForResponse((response) =>
    response.url().includes('/api/widget/v1/conversations/current'),
  );
  await page.goto(`${HOST}/hostile.html?key=${encodeURIComponent(seeded.publicKey)}`);
  await page.getByRole('button', { name: 'Open chat' }).click();
  await booted;
  await expect(page.getByRole('dialog', { name: 'Support' })).toBeVisible();

  // An out-of-scope question escalates and offers a person.
  await ask(page, 'Do you offer a student discount?');
  await expect(page.getByText(/I couldn't find that/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, connect me' }).click();

  await page.getByLabel('Your email (optional)').fill('visitor@example.com');
  await page
    .locator('form.ailoom-email')
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  await expect(page.getByText(/our team will reply here/)).toBeVisible();

  // The handoff email reaches the workspace inbox and links to the conversation.
  const notification = await mailpit.lastEmailTo(OWNER.email, /needs help with Support/i);
  const href = /https?:\/\/[^\s<>")\]]+\/w\/[^\s<>")\]]+\/conversations\/[^\s<>")\]]+/.exec(
    notification.text,
  );
  if (href === null)
    throw new Error(`the handoff email has no conversation link:\n${notification.text}`);
  const conversationUrl = href[0];

  // The agent signs in in a second browser context.
  const agentContext = await browser.newContext();
  const agent = await agentContext.newPage();
  await logIn(agent);

  // The inbox shows the needs-human badge before the agent opens the email link.
  await agent.goto(`/w/${seeded.workspaceId}/conversations`);
  await expect(agent.getByRole('link', { name: /Conversations/ })).toContainText('1');
  const row = agent.getByRole('row').filter({ hasText: 'visitor@example.com' });
  await expect(row.getByText('Needs human').first()).toBeVisible();

  // Opening the link from the email lands on the same conversation.
  await agent.goto(conversationUrl);
  await expect(agent.getByText('Needs human').first()).toBeVisible();
  await agent.getByLabel('Priority').selectOption('urgent');
  await expect(agent.getByText('Urgent', { exact: true }).first()).toBeVisible();
  await agent.goto(`/w/${seeded.workspaceId}/conversations?priority=urgent&assignedTo=none`);
  const urgentRow = agent.getByRole('row').filter({ hasText: 'visitor@example.com' });
  await expect(urgentRow).toBeVisible();
  await urgentRow.getByRole('link').click();
  await expect(agent).toHaveURL(/\/conversations\/[0-9a-f-]+$/);
  const assignment = agent.getByLabel('Assigned to');
  await assignment.selectOption({ index: 1 });
  await expect(assignment).not.toHaveValue('');
  const note = 'Check the carrier scan before replying.';
  await agent.getByLabel('Write an internal note').fill(note);
  await agent.getByRole('button', { name: 'Add internal note' }).click();
  await expect(agent.getByText(note)).toBeVisible();
  await expect(page.getByText(note)).toHaveCount(0);

  await agent.getByLabel('Saved replies').selectOption({ label: 'Return follow-up' });
  await agent.getByRole('button', { name: 'Insert reply' }).click();
  await expect(agent.getByLabel('Reply to the visitor')).toHaveValue(
    'I can help start your return.',
  );
  expect((await new AxeBuilder({ page: agent }).analyze()).violations).toEqual([]);
  await agent.setViewportSize({ width: 390, height: 844 });
  await expect(agent.getByLabel('Reply to the visitor')).toBeVisible();
  expect(
    await agent.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await agent.setViewportSize({ width: 1280, height: 900 });

  const reply = 'I can help start your return.';
  const sentAt = Date.now();
  await agent.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText(reply)).toBeVisible({ timeout: 2_000 });
  expect(Date.now() - sentAt).toBeLessThan(2_000);

  // Handing back lets the assistant answer the next question once knowledge exists.
  await agent.getByRole('button', { name: 'Hand back to AI' }).click();
  await addKnowledge(api, seeded.base, seeded.botId);
  await ask(page, FAQ);
  await expect(page.getByText(/Mock answer about/).last()).toBeVisible();

  await agent.getByRole('button', { name: 'Take over' }).click();
  await agent.getByRole('button', { name: 'Generate suggestion' }).click();
  const suggestion = agent.getByRole('region', { name: 'Suggested reply' });
  await expect(suggestion.getByText(/Mock answer about/)).toBeVisible({ timeout: 30_000 });
  await expect(suggestion.getByText('Refund policy')).toBeVisible();
  agent.once('dialog', (dialog) => dialog.accept());
  await suggestion.getByRole('button', { name: /draft/i }).click();
  const suggestedDraft = await agent.getByLabel('Reply to the visitor').inputValue();
  expect(suggestedDraft).toContain('Mock answer about');
  await agent.getByLabel('Reply to the visitor').fill(`${suggestedDraft} I checked the policy.`);
  await agent.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText(/I checked the policy/)).toBeVisible();

  // The answer reaches the open conversation, and its replay shows retrieval and cost.
  await expect(agent.getByText(/Mock answer about/).last()).toBeVisible();
  await agent.getByRole('button', { name: 'Answer details' }).last().click();
  const drawer = agent.getByRole('dialog', { name: 'Answer details' });
  await expect(drawer.getByRole('cell', { name: 'Refund policy' })).toBeVisible();
  await expect(drawer.getByText('Cost', { exact: true })).toBeVisible();

  await agentContext.close();
  await api.dispose();
});
