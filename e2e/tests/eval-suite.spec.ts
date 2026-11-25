// SPDX-License-Identifier: AGPL-3.0-only
import { type APIRequestContext, type APIResponse, type Page, request } from '@playwright/test';

import { expect, extractLink, test } from '../fixtures';
import { mailpit } from '../mailpit';
import { BASE_URL } from '../stack';

const API = '/api/v1';
const OWNER = { email: 'owner@acme.test', password: 'lighthouse kettle 2026' };
const HOST = 'http://shop.localhost:8090';

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok())
    throw new Error(
      `${response.url()} answered ${String(response.status())}: ${await response.text()}`,
    );
  return (await response.json()) as T;
}

async function authenticate(api: APIRequestContext): Promise<void> {
  const login = await api.post(`${API}/auth/login`, { data: OWNER });
  if (login.ok()) return;
  await json(await api.post(`${API}/auth/signup`, { data: { ...OWNER, name: 'Eval Owner' } }));
  const email = await mailpit.lastEmailTo(OWNER.email, /verify/i);
  const token = new URL(extractLink(email.text, '/verify-email')).searchParams.get('token');
  if (token === null) throw new Error('the verification link has no token');
  await json(await api.post(`${API}/auth/verify-email`, { data: { token } }));
  await json(await api.post(`${API}/auth/login`, { data: OWNER }));
}

async function logIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

test('creates a dataset, adds cases, runs it, and opens the results', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: BASE_URL, 'X-Requested-With': 'fetch' },
  });
  await authenticate(api);
  const workspace = await json<{ id: string }>(
    await api.post(`${API}/workspaces`, { data: { name: 'Eval Suite E2E' } }),
  );
  const base = `${API}/workspaces/${workspace.id}`;
  const credential = await json<{ id: string }>(
    await api.post(`${base}/credentials`, { data: { provider: 'mock', label: 'Eval mock' } }),
  );
  const bot = await json<{ id: string }>(
    await api.post(`${base}/bots`, {
      data: {
        name: 'Eval support',
        chatCredentialId: credential.id,
        chatModel: 'mock-chat',
        embeddingCredentialId: credential.id,
        embeddingModel: 'mock-embed',
        allowedOrigins: [HOST],
        retrievalThreshold: 0,
      },
    }),
  );

  await logIn(page);
  await page.goto(`/w/${workspace.id}/bots/${bot.id}/evaluate`);
  await page.getByLabel('New dataset name').fill('Smoke cases');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#eval-dataset option:checked')).toHaveText('Smoke cases (0 cases)');
  const cases: [string, string][] = [
    ['Where is the support team?', 'Contact support by email.'],
    ['When will support reply?', 'The team replies within one business day.'],
  ];
  for (const [question, answer] of cases) {
    await page.getByLabel('Question').fill(question);
    await page.getByLabel('Expected answer').fill(answer);
    await page.getByRole('button', { name: 'Add case' }).click();
    await expect(page.getByText(question)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText(/completed · 2\/2/)).toBeVisible({ timeout: 120_000 });
  await page
    .getByRole('button', { name: /20\d\d-/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Run results' })).toBeVisible();
  await expect(page.getByText(/Mock answer about/).first()).toBeVisible({ timeout: 30_000 });
  await api.dispose();
});
