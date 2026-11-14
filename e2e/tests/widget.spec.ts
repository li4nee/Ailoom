// SPDX-License-Identifier: AGPL-3.0-only
import AxeBuilder from '@axe-core/playwright';
import { type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';

import { expect, test } from '../fixtures';
import { extractLink, mailpit } from '../mailpit';
import { BASE_URL } from '../stack';

const API = '/api/v1';
const HOST = 'http://shop.localhost:8090';
const ORIGIN = HOST;
const OWNER = { email: 'owner@acme.test', password: 'lighthouse kettle 2026' };
const FAQ =
  'Refunds are processed within five business days. Contact support with your order number to start a return.';

interface Seed {
  publicKey: string;
}

interface CreatedWorkspace {
  id: string;
}

interface CreatedCredential {
  id: string;
}

interface CreatedBot {
  id: string;
  publicKey: string;
}

interface CreatedSource {
  id: string;
  status: string;
}

async function json<T>(response: APIResponse): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${response.url()} answered ${String(response.status())}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** Signs the first test user up (the throwaway stack starts empty) and verifies the email. */
async function authenticate(api: APIRequestContext): Promise<void> {
  const login = await api.post(`${API}/auth/login`, { data: OWNER });
  if (login.ok()) return;

  const signup = await api.post(`${API}/auth/signup`, {
    data: { email: OWNER.email, password: OWNER.password, name: 'Widget Owner' },
  });
  if (!signup.ok())
    throw new Error(`signup answered ${String(signup.status())}: ${await signup.text()}`);

  const email = await mailpit.lastEmailTo(OWNER.email, /verify/i);
  const token = new URL(extractLink(email.text, '/verify-email')).searchParams.get('token');
  if (token === null) throw new Error('the verification link has no token');
  await json(await api.post(`${API}/auth/verify-email`, { data: { token } }));
  await json(await api.post(`${API}/auth/login`, { data: OWNER }));
}

/** Creates a workspace, a mock credential, a bot for the host origin and one text source. */
async function seed(api: APIRequestContext): Promise<Seed> {
  await authenticate(api);

  const workspace = await json<CreatedWorkspace>(
    await api.post(`${API}/workspaces`, { data: { name: 'Widget E2E' } }),
  );
  const base = `${API}/workspaces/${workspace.id}`;

  const credential = await json<CreatedCredential>(
    await api.post(`${base}/credentials`, { data: { provider: 'mock', label: 'Mock' } }),
  );

  const bot = await json<CreatedBot>(
    await api.post(`${base}/bots`, {
      data: {
        name: 'Support',
        chatCredentialId: credential.id,
        chatModel: 'mock-chat',
        embeddingCredentialId: credential.id,
        embeddingModel: 'mock-embed',
        allowedOrigins: [ORIGIN],
        // The mock embedding is hash-based, not semantic: a zero threshold keeps retrieval
        // deterministic so the answer can cite the pasted document.
        retrievalThreshold: 0,
      },
    }),
  );

  const source = await json<CreatedSource>(
    await api.post(`${base}/bots/${bot.id}/sources`, {
      data: { type: 'text', title: 'Refund policy', body: FAQ },
    }),
  );

  // Ingestion is asynchronous: the worker embeds the document before the widget can cite it.
  await expect
    .poll(
      async () => {
        const detail = await json<CreatedSource>(
          await api.get(`${base}/bots/${bot.id}/sources/${source.id}`),
        );
        return detail.status;
      },
      { timeout: 120_000, message: 'the knowledge source becomes ready' },
    )
    .toBe('ready');

  return { publicKey: bot.publicKey };
}

function hostUrl(path: string, publicKey: string): string {
  return `${HOST}/${path}?key=${encodeURIComponent(publicKey)}`;
}

/** Opens the host page, waits for the launcher, and opens the booted panel. */
async function open(page: Page, path: string, publicKey: string): Promise<void> {
  const booted = page.waitForResponse((response) =>
    response.url().includes('/api/widget/v1/conversations/current'),
  );
  await page.goto(hostUrl(path, publicKey));
  const launcher = page.getByRole('button', { name: 'Open chat' });
  await expect(launcher).toBeVisible();
  await launcher.click();
  await booted;
  await expect(page.getByRole('dialog', { name: 'Support' })).toBeVisible();
}

function composer(page: Page) {
  return page.getByRole('textbox', { name: 'Type your message…' });
}

/** Sends a message and waits for the mock provider's streamed answer. */
async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/Mock answer about/).last()).toBeVisible();
}

test.describe('widget on host pages', () => {
  let seedData: Seed;

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        // The admin API requires both on every mutating request (CSRF guard).
        Origin: BASE_URL,
        'X-Requested-With': 'fetch',
      },
    });
    try {
      seedData = await seed(api);
    } finally {
      await api.dispose();
    }
  });

  test('survives aggressive host CSS and renders readable messages', async ({ page }) => {
    await open(page, 'hostile.html', seedData.publicKey);
    await ask(page, FAQ);

    const font = await page
      .locator('.ailoom-message[data-role="ai"]')
      .last()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(font).toBeGreaterThanOrEqual(14);
    expect(await page.getByRole('dialog', { name: 'Support' }).isVisible()).toBe(true);
  });

  test('loads, answers and logs no CSP violations under a strict policy', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /Content Security Policy|Refused to/i.test(message.text())
      ) {
        violations.push(message.text());
      }
    });
    page.on('pageerror', (error) => violations.push(error.message));

    await open(page, 'strict-csp.html', seedData.publicKey);
    await ask(page, FAQ);

    expect(violations).toEqual([]);
  });

  test('persists across SPA route changes and keeps the conversation', async ({ page }) => {
    await open(page, 'spa.html', seedData.publicKey);
    await ask(page, FAQ);

    await page.getByRole('button', { name: 'Browse products' }).click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByRole('dialog', { name: 'Support' })).toBeVisible();
    await expect(page.getByText(/Mock answer about/)).toHaveCount(1);

    await ask(page, FAQ);
    await expect(page.getByText(/Mock answer about/)).toHaveCount(2);
  });

  test('answers with citations and records a thumbs down', async ({ page }) => {
    await open(page, 'hostile.html', seedData.publicKey);
    await ask(page, FAQ);

    // A pasted text source has no URL, so its citation renders as plain text.
    await expect(page.getByText('Refund policy')).toBeVisible();

    const down = page.getByRole('button', { name: 'Not helpful' });
    await down.click();
    await expect(down).toHaveAttribute('aria-pressed', 'true');
  });

  test('marks an interrupted answer and retries once back online', async ({ page, context }) => {
    await open(page, 'hostile.html', seedData.publicKey);
    await ask(page, FAQ);

    await context.setOffline(true);
    await composer(page).fill(FAQ);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('This answer was interrupted.')).toBeVisible();

    await context.setOffline(false);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText(/Mock answer about/)).toHaveCount(2);
  });

  test('fills a mobile viewport and keeps the composer reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'hostile.html', seedData.publicKey);

    const panel = page.getByRole('dialog', { name: 'Support' });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBe(390);
    expect(box?.height).toBe(844);

    // A shorter viewport stands in for the software keyboard opening.
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(composer(page)).toBeVisible();
    const composerBox = await composer(page).boundingBox();
    expect(composerBox).not.toBeNull();
    expect((composerBox?.y ?? 0) + (composerBox?.height ?? 0)).toBeLessThanOrEqual(500);
  });

  test('has no serious or critical axe violations with the panel open', async ({ page }) => {
    await open(page, 'hostile.html', seedData.publicKey);
    await ask(page, FAQ);

    const results = await new AxeBuilder({ page }).include('ailoom-chat').analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking).toEqual([]);
  });

  test('shows unavailable on an origin the bot does not allow', async ({ page }) => {
    await page.goto(
      `http://127.0.0.1:8090/hostile.html?key=${encodeURIComponent(seedData.publicKey)}`,
    );
    await page.getByRole('button', { name: 'Open chat' }).click();
    await expect(page.getByText('Chat is unavailable right now.')).toBeVisible();
  });
});
