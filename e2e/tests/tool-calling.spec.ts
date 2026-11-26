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
    await logIn(page);
    await page.goto(`/w/${workspace.id}/bots/${bot.id}/tools`);
    await expect(page.getByLabel('Development/test mock result')).toHaveValue('null');
    await page.getByLabel('Tool name').fill('check_stock');
    await page.getByLabel('Description').fill('Check current stock for a product.');
    await page
      .getByLabel('Use when', { exact: true })
      .fill('Use when the visitor asks whether an item is available.');
    await page
      .getByLabel('Never use when')
      .fill('Never use for delivery dates or order-specific questions.');
    await page
      .getByLabel('If the call fails or required information is missing')
      .fill('Say you could not verify stock and offer human help.');
    await page.getByLabel('HTTPS endpoint').fill('https://inventory.example.test/products');
    await page.getByLabel('Allowed response fields').fill(
      JSON.stringify([
        {
          path: 'status',
          name: 'status',
          description: 'Whether the product is available.',
          visibleToVisitor: true,
        },
      ]),
    );
    await page.getByLabel('Development/test mock result').fill('{"status":"available"}');
    await page.getByRole('button', { name: 'Save tool' }).click();
    await expect(page.getByRole('button', { name: /check_stock/ })).toBeVisible();
    const [tool] = await json<{ id: string }[]>(await api.get(tools));
    if (tool === undefined) throw new Error('the admin UI did not create the tool');
    await page.getByRole('button', { name: 'Test endpoint' }).click();
    await expect(page.getByRole('heading', { name: 'Test succeeded' })).toBeVisible();

    await page
      .getByLabel('Use when', { exact: true })
      .fill('Use when the visitor asks about current availability for one product.');
    await expect(page.getByLabel('Enable this tool for visitor chats')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Test endpoint' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save tool' }).click();
    await page.getByRole('button', { name: 'Test endpoint' }).click();
    await expect(page.getByRole('heading', { name: 'Test succeeded' })).toBeVisible();
    await page.getByLabel('Enable this tool for visitor chats').check();
    const enableSave = page.waitForResponse(
      (response) =>
        response.url().includes(`/tools/${tool.id}`) && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save tool' }).click();
    expect((await enableSave).ok()).toBe(true);
    await expect(page.getByLabel('Enable this tool for visitor chats')).toBeChecked();

    const booted = page.waitForResponse((response) =>
      response.url().includes('/api/widget/v1/conversations/current'),
    );
    const platformMode = new URL(BASE_URL).port === '18082' ? 'alternate' : 'default';
    await page.goto(
      `${HOST}/hostile.html?key=${encodeURIComponent(bot.publicKey)}&platform=${platformMode}`,
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
