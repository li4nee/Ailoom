// SPDX-License-Identifier: AGPL-3.0-only
import { type APIRequestContext, type APIResponse, type Page, request } from '@playwright/test';

import { expect, extractLink, test } from '../fixtures';
import { mailpit } from '../mailpit';
import { BASE_URL } from '../stack';

const API = '/api/v1';
const HOST = 'http://shop.localhost:8090';
const OWNER = { email: 'owner@acme.test', password: 'lighthouse kettle 2026' };

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
  await json(await api.post(`${API}/auth/signup`, { data: { ...OWNER, name: 'Tool Owner' } }));
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

test('runs a bounded mock tool, records its trace, then falls back when disabled', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Origin: BASE_URL, 'X-Requested-With': 'fetch' },
  });
  try {
    await authenticate(api);
    const workspace = await json<{ id: string }>(
      await api.post(`${API}/workspaces`, { data: { name: 'Tool Calling E2E' } }),
    );
    const base = `${API}/workspaces/${workspace.id}`;
    const credential = await json<{ id: string }>(
      await api.post(`${base}/credentials`, { data: { provider: 'mock', label: 'Mock' } }),
    );
    const bot = await json<{ id: string; publicKey: string }>(
      await api.post(`${base}/bots`, {
        data: {
          name: 'Tool support',
          chatCredentialId: credential.id,
          chatModel: 'mock-chat',
          embeddingCredentialId: credential.id,
          embeddingModel: 'mock-embed',
          allowedOrigins: [HOST],
          retrievalThreshold: 0,
        },
      }),
    );
    const tools = `${base}/bots/${bot.id}/tools`;
    const tool = await json<{ id: string }>(
      await api.post(tools, {
        data: {
          name: 'check_stock',
          description: 'Check current stock for a product.',
          useWhen: 'Use when the visitor asks whether an item is available.',
          neverUse: 'Never use for delivery dates or order-specific questions.',
          failureBehavior: 'Say you could not verify stock and offer human help.',
          enabled: false,
          endpoint: 'https://inventory.example.test/products',
          authHeaderName: null,
          inputs: [],
          query: [],
          responseFields: [
            {
              path: 'status',
              name: 'status',
              description: 'Whether the product is available.',
              visibleToVisitor: true,
            },
          ],
          mockResponse: { status: 'available' },
          timeoutMs: 2_000,
          maxCalls: 1,
          testArguments: {},
        },
      }),
    );
    await json(await api.post(`${tools}/${tool.id}/test`));
    await json(await api.patch(`${tools}/${tool.id}`, { data: { enabled: true } }));

    await logIn(page);
    const booted = page.waitForResponse((response) =>
      response.url().includes('/api/widget/v1/conversations/current'),
    );
    await page.goto(
      `${HOST}/hostile.html?key=${encodeURIComponent(bot.publicKey)}&platform=${encodeURIComponent(BASE_URL)}`,
    );
    await page.getByRole('button', { name: 'Open chat' }).click();
    await booted;
    await expect(page.getByRole('dialog', { name: 'Support' })).toBeVisible();
    const send = page.waitForResponse((response) =>
      /\/api\/widget\/v1\/conversations\/[^/]+\/messages$/.test(response.url()),
    );
    await page.getByRole('textbox', { name: 'Type your message…' }).fill('Is the item in stock?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const messageResponse = await send;
    const conversationId = new URL(messageResponse.url()).pathname.split('/').at(-2);
    await expect(page.getByText(/Tool result:.*available/).last()).toBeVisible();
    if (conversationId === undefined) throw new Error('widget message URL had no conversation id');

    interface Detail {
      messages: { id: string; role: string; traceId: string | null }[];
    }
    let detail: Detail = { messages: [] };
    await expect
      .poll(
        async () => {
          detail = await json<Detail>(await api.get(`${base}/conversations/${conversationId}`));
          return detail.messages.filter((message) => message.role === 'ai').at(-1)?.traceId ?? null;
        },
        { timeout: 30_000, message: 'the persisted answer is linked to its generation trace' },
      )
      .not.toBeNull();
    const assistantMessage = detail.messages.filter((message) => message.role === 'ai').at(-1);
    if (assistantMessage?.traceId === null || assistantMessage?.traceId === undefined)
      throw new Error('tool answer did not produce a linked trace');
    const trace = await json<{ toolCalls: { name: string; status: string }[] }>(
      await api.get(`${base}/traces/${assistantMessage.traceId}`),
    );
    expect(trace.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'check_stock', status: 'complete' }),
      ]),
    );

    await json(await api.patch(`${tools}/${tool.id}`, { data: { enabled: false } }));
    await page.getByRole('textbox', { name: 'Type your message…' }).fill('Is this item in stock?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(/I couldn't find that in our help content/).last()).toBeVisible();
  } finally {
    await api.dispose();
  }
});
