// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Record the README demo GIF and screenshots against a seeded stack (M7 Task 7.10).
 *
 *   PUBLIC_URL=http://localhost:18090 DEMO_PUBLIC_KEY=pk_live_northwind_demo \
 *     pnpm --filter @app/e2e exec node -r @swc-node/register scripts/record-demo.ts
 *
 * Requires ffmpeg on PATH. Writes docs/assets/demo.gif and screenshot-*.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';

const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'http://localhost:18090';
const HOST_PORT = Number(process.env['HOST_PORT'] ?? 8090);
const PUBLIC_KEY = process.env['DEMO_PUBLIC_KEY'] ?? 'pk_live_northwind_demo';
const EMAIL = process.env['DEMO_EMAIL'] ?? 'dev@example.com';
const PASSWORD = process.env['DEMO_PASSWORD'] ?? 'devpassword';
const OUTPUT = resolve(
  process.env['DEMO_OUTPUT'] ??
    resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/assets'),
);
const VIDEO_DIR = join(tmpdir(), `ailoom-demo-${String(Date.now())}`);

const HOST_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Northwind Outfitters</title>
<style>
  body { margin:0; font:16px/1.5 system-ui,sans-serif; background:#f6f3ec; color:#1f2933; }
  header { padding:18px 40px; display:flex; justify-content:space-between; border-bottom:1px solid #e4ded1; }
  main { max-width:920px; margin:56px auto; padding:0 24px; }
  h1 { font-size:42px; line-height:1.1; margin:0 0 12px; }
  p { max-width:540px; color:#52606d; }
  .card { margin-top:32px; padding:24px; background:#fff; border:1px solid #e4ded1; border-radius:12px; max-width:420px; }
  .price { font-weight:700; }
</style>
</head>
<body>
<header><strong>NORTHWIND</strong><span>Shop · Journal · Support</span></header>
<main>
  <h1>Gear that lasts beyond the season.</h1>
  <p>Field-tested jackets, packs and layers. Free shipping over $75, and a return policy we
  actually explain.</p>
  <div class="card"><h2>Trailhead Jacket</h2><p>Waterproof shell, pit zips, three pockets.</p>
  <p class="price">$189</p></div>
</main>
<script src="${PUBLIC_URL}/widget.js" data-key="${PUBLIC_KEY}" async></script>
</body>
</html>`;

async function hostPage(): Promise<Page> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${String(HOST_PORT)}/`);
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByPlaceholder('Type your message…').fill('What is your refund policy?');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.ailoom-message[data-role="ai"]').last().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2_500);
  return page;
}

async function admin(page: Page): Promise<string> {
  await page.goto(`${PUBLIC_URL}/login`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+/);
  return new URL(page.url()).pathname.replace(/\/$/, '');
}

async function main(): Promise<void> {
  await mkdir(OUTPUT, { recursive: true });
  await rm(VIDEO_DIR, { recursive: true, force: true });
  await mkdir(VIDEO_DIR, { recursive: true });

  const server = createServer((request, response) => {
    if (request.url === '/' || request.url === '/host.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(HOST_PAGE);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise<void>((ready) => server.listen(HOST_PORT, ready));

  const videoPage = await hostPage();
  const context = videoPage.context();
  const browser = context.browser();
  const workspace = await admin(videoPage);

  await videoPage.goto(`${PUBLIC_URL}${workspace}/conversations`);
  await videoPage.getByRole('heading', { name: 'Conversations' }).waitFor();
  await videoPage.screenshot({ path: join(OUTPUT, 'screenshot-inbox.png') });

  const hrefs = await videoPage
    .locator('a[href*="/conversations/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  let opened = false;
  for (const href of hrefs) {
    if (href === null) continue;
    await videoPage.goto(`${PUBLIC_URL}${href}`);
    await videoPage.waitForTimeout(1_000);
    const trace = videoPage.getByRole('button', { name: 'Answer details' }).first();
    if ((await trace.count()) > 0) {
      await trace.click();
      await videoPage.getByRole('heading', { name: 'Answer details' }).waitFor();
      opened = true;
      break;
    }
  }
  if (!opened) throw new Error('no seeded conversation has a trace');
  await videoPage.waitForTimeout(600);
  await videoPage.screenshot({ path: join(OUTPUT, 'screenshot-replay.png') });

  await videoPage.goto(`${PUBLIC_URL}${workspace}/knowledge`);
  await videoPage.locator('a[href*="/bots/"][href*="/knowledge"]').first().click();
  await videoPage.getByRole('heading', { name: 'Knowledge' }).waitFor();
  await videoPage.getByText('Northwind help center').waitFor();
  await videoPage.screenshot({ path: join(OUTPUT, 'screenshot-knowledge.png') });

  await videoPage.goto(`${PUBLIC_URL}${workspace}/usage`);
  await videoPage.getByRole('heading', { name: 'Usage' }).waitFor();
  await videoPage.getByRole('button', { name: 'Table view' }).click();
  await videoPage.waitForTimeout(1_500);
  await videoPage.screenshot({ path: join(OUTPUT, 'screenshot-usage.png') });

  const video = videoPage.video();
  await context.close();
  await browser?.close();
  if (video === null) throw new Error('Playwright recorded no video');
  const videoPath = await video.path();

  const palette = join(VIDEO_DIR, 'palette.png');
  const gif = join(OUTPUT, 'demo.gif');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-t',
      '22',
      '-vf',
      'fps=12,scale=960:-1:flags=lanczos,palettegen',
      palette,
    ],
    {
      stdio: 'ignore',
    },
  );
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-i',
      palette,
      '-t',
      '22',
      '-lavfi',
      'fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse',
      '-loop',
      '0',
      gif,
    ],
    { stdio: 'ignore' },
  );

  server.close();
  await rm(VIDEO_DIR, { recursive: true, force: true });
  process.stdout.write(`wrote ${gif} and four screenshots to ${OUTPUT}\n`);
}

await main();
