// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Record the README product tours and supporting screenshots against a seeded stack.
 *
 *   PUBLIC_URL=http://localhost:18090 DEMO_PUBLIC_KEY=pk_live_northwind_demo \
 *     pnpm --filter @app/e2e exec node -r @swc-node/register scripts/record-demo.ts
 *
 * Requires ffmpeg and a seeded demo stack. Writes admin-tour.gif, widget-tour.gif,
 * handoff-tour.gif, and inbox, knowledge, and usage screenshots under docs/assets. The original
 * visitor conversation demo.gif is preserved.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

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
const VIEWPORT = { width: 1440, height: 900 };

const HOST_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Northwind Outfitters — Field gear, made to last</title>
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #19251b; background: #f5f4ee; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; }
  .announcement { background: #1c2b20; color: #f5f4ee; padding: 9px 24px; text-align: center; font-size: 12px; letter-spacing: .04em; }
  header { height: 76px; padding: 0 max(32px, calc((100vw - 1180px)/2)); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #dedfd4; background: #f5f4ee; }
  .brand { font-family: Georgia, serif; font-size: 25px; font-weight: 700; letter-spacing: .06em; }
  nav { display: flex; gap: 30px; color: #526052; font-size: 13px; }
  .cart { font-size: 12px; border: 1px solid #c9cfc1; border-radius: 99px; padding: 9px 15px; }
  main { max-width: 1180px; margin: 42px auto 70px; padding: 0 32px; }
  .hero { min-height: 470px; display: grid; grid-template-columns: 1fr 1fr; overflow: hidden; border-radius: 5px; background: #dce2d2; }
  .copy { padding: 68px 60px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; }
  .eyebrow { color: #5f7057; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
  h1 { max-width: 430px; margin: 18px 0; font-family: Georgia, serif; font-size: clamp(42px, 4vw, 60px); font-weight: 400; line-height: 1.02; letter-spacing: -.035em; }
  .copy p { max-width: 390px; margin: 0; color: #526052; font-size: 15px; line-height: 1.7; }
  .shop { margin-top: 28px; padding: 13px 20px; border-radius: 3px; background: #1c2b20; color: white; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
  .photo { position: relative; min-height: 470px; overflow: hidden; background: linear-gradient(145deg,#b9c5ae,#82927a); }
  .sun { position: absolute; width: 210px; height: 210px; border-radius: 50%; top: 50px; right: 74px; background: #e4d9b8; opacity: .9; }
  .ridge { position:absolute; inset: auto -12% 0; height: 66%; background:#6e806e; clip-path: polygon(0 58%,28% 14%,43% 45%,66% 4%,100% 67%,100% 100%,0 100%); }
  .ridge.back { bottom: 0; height: 80%; background:#9eae97; clip-path: polygon(0 65%,31% 28%,52% 56%,76% 16%,100% 50%,100% 100%,0 100%); }
  .jacket { position:absolute; z-index:1; right:25%; bottom:5%; width:210px; height:300px; border-radius:95px 95px 22px 22px; background:#d4a65d; clip-path: polygon(31% 0,69% 0,83% 9%,100% 35%,83% 45%,76% 34%,80% 100%,20% 100%,24% 34%,17% 45%,0 35%,17% 9%); filter:drop-shadow(14px 15px 12px #25362944); }
  .detail { position:absolute; z-index:2; right:42%; bottom:8%; width:2px; height:215px; background:#8c6233; transform:rotate(1deg); }
  .below { display:flex; align-items:center; justify-content:space-between; padding:22px 2px; color:#5d695d; font-size:12px; }
  .below strong { color:#243327; font-family:Georgia,serif; font-size:17px; font-weight:400; }
</style>
</head>
<body>
<div class="announcement">COMPLIMENTARY SHIPPING ON ORDERS OVER $75</div>
<header><div class="brand">NORTHWIND</div><nav><span>Shop</span><span>Our story</span><span>Field notes</span></nav><div class="cart">Bag&nbsp;&nbsp; 0</div></header>
<main><section class="hero"><div class="copy"><span class="eyebrow">Built for the long way around</span><h1>Good gear takes you further.</h1><p>Thoughtful layers and field-tested essentials for wherever the trail leads next.</p><span class="shop">Explore the collection&nbsp; ↗</span></div><div class="photo" aria-label="Illustration of a trail jacket in the mountains"><div class="sun"></div><div class="ridge back"></div><div class="ridge"></div><div class="jacket"></div><div class="detail"></div></div></section><div class="below"><strong>Made for outside. Ready for everyday.</strong><span>Free returns within 30 days&nbsp; →</span></div></main>
<script src="${PUBLIC_URL}/widget.js" data-key="${PUBLIC_KEY}" async></script>
</body>
</html>`;

const STARTER_SOURCE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Northwind Outfitters</title>
  <style>
    body { margin: 0; background: #f5f4ee; color: #19251b; font: 16px system-ui; }
    header { padding: 24px 7%; border-bottom: 1px solid #dedfd4; letter-spacing: .12em; }
    main { max-width: 760px; margin: 110px auto; padding: 0 32px; }
    small { color: #64735f; letter-spacing: .16em; }
    h1 { max-width: 600px; margin: 18px 0; font: 400 64px/1 Georgia, serif; }
    p { color: #526052; line-height: 1.7; }
    .button { display: inline-block; margin-top: 16px; padding: 14px 20px; background: #1c2b20; color: white; }
  </style>
</head>
<body>
  <header>NORTHWIND</header>
  <main>
    <small>FIELD-TESTED OUTDOOR GOODS</small>
    <h1>Good gear takes you further.</h1>
    <p>Thoughtful layers and essentials for wherever the trail leads next.</p>
    <span class="button">Explore the collection</span>
  </main>
  <!-- Paste the AiLoom script here -->
</body>
</html>`;

const INTEGRATION_EDITOR = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add the AiLoom widget</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f5f1; color: #1c2820; font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
  header { height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 0 34px; border-bottom: 1px solid #dfe3dc; background: white; }
  header strong { font-size: 14px; letter-spacing: .12em; }
  .tag { color: #536450; font-size: 12px; }
  main { max-width: 1340px; margin: 34px auto; padding: 0 28px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -.025em; }
  .intro { margin: 5px 0 22px; color: #647067; }
  .steps { display: flex; gap: 10px; margin-bottom: 16px; color: #5f6c60; font-size: 12px; }
  .steps span { padding: 7px 11px; border: 1px solid #d9dfd6; border-radius: 99px; background: white; }
  .steps b { color: #1c2820; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .panel { min-width: 0; overflow: hidden; border: 1px solid #dce1da; border-radius: 9px; background: white; box-shadow: 0 3px 12px #1d2a2010; }
  .panel-head { height: 46px; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; border-bottom: 1px solid #e6e9e4; }
  .panel-head strong { font-size: 12px; }
  .panel-head span { color: #7a857b; font-size: 11px; }
  textarea { display: block; width: 100%; height: 530px; resize: none; border: 0; outline: 0; padding: 19px 20px; background: #15201a; color: #dce8d8; font: 12px/1.75 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
  .preview-wrap { height: 576px; padding: 12px; background: #e9ece7; }
  .preview-wrap.active { position: fixed; z-index: 10; inset: 62px 0 0; height: auto; padding: 0; background: white; }
  iframe { width: 100%; height: 100%; border: 1px solid #d6ddd3; border-radius: 5px; background: white; }
  .run { border: 0; border-radius: 6px; padding: 9px 14px; background: #c7f36b; color: #233019; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
  @media (max-width: 900px) { main { margin: 20px auto; } .grid { grid-template-columns: 1fr; } textarea { height: 320px; } }
</style>
</head>
<body>
<header><strong>AILOOM <span class="tag">/ QUICK INSTALL</span></strong><span class="tag">Local integration demo</span></header>
<main>
  <h1>Add support chat to your site</h1>
  <p class="intro">Copy one script tag, paste it before <code>&lt;/body&gt;</code>, and preview your live widget.</p>
  <div class="steps"><span><b>1</b>&nbsp; Copy snippet</span><span><b>2</b>&nbsp; Paste into index.html</span><span><b>3</b>&nbsp; Preview</span></div>
  <div class="grid">
    <section class="panel"><div class="panel-head"><strong>index.html</strong><span>HTML</span></div><textarea id="source-code" spellcheck="false" aria-label="index.html source"></textarea></section>
    <section class="panel"><div class="panel-head"><strong>Live preview</strong><button class="run" id="run-preview">Run preview&nbsp; ↗</button></div><div class="preview-wrap"><iframe title="Storefront preview"></iframe></div></section>
  </div>
</main>
<script>
  const source = document.querySelector('#source-code');
  source.value = ${JSON.stringify(STARTER_SOURCE)};
  document.querySelector('#run-preview').addEventListener('click', () => {
    const preview = document.querySelector('iframe');
    preview.srcdoc = source.value;
    preview.parentElement.classList.add('active');
  });
</script>
</body>
</html>`;

async function startVideo(
  browser: Browser,
  name: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: join(VIDEO_DIR, name), size: VIEWPORT },
  });
  return { context, page: await context.newPage() };
}

async function saveGif(
  page: Page,
  context: BrowserContext,
  filename: string,
  seconds: number,
  options: { fps?: number; width?: number } = {},
): Promise<void> {
  const fps = options.fps ?? 10;
  const width = options.width ?? 960;
  const video = page.video();
  await context.close();
  if (video === null) throw new Error(`Playwright recorded no video for ${filename}`);
  const videoPath = await video.path();
  const palette = join(VIDEO_DIR, `${filename}.palette.png`);
  const gif = join(OUTPUT, filename);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-t',
      String(seconds),
      '-vf',
      `fps=${String(fps)},scale=${String(width)}:-1:flags=lanczos,palettegen=stats_mode=diff`,
      palette,
    ],
    { stdio: 'ignore' },
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
      String(seconds),
      '-lavfi',
      `fps=${String(fps)},scale=${String(width)}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
      '-loop',
      '0',
      gif,
    ],
    { stdio: 'ignore' },
  );
  process.stdout.write(`wrote ${gif}\n`);
}

async function recordWidgetTour(browser: Browser): Promise<void> {
  const { context, page } = await startVideo(browser, 'widget');
  const storefront = page;
  await storefront.goto(`http://localhost:${String(HOST_PORT)}/host.html`);
  await storefront.getByRole('button', { name: 'Open chat' }).waitFor({ timeout: 30_000 });
  await storefront.waitForTimeout(500);
  await storefront.getByRole('button', { name: 'Open chat' }).click();
  await storefront.waitForTimeout(1_000);
  const composer = storefront.getByPlaceholder('Type your message…');
  await composer.fill('What is your return policy?');
  await storefront.getByRole('button', { name: 'Send' }).click();
  await storefront
    .locator('.ailoom-message[data-role="visitor"]')
    .last()
    .waitFor({ timeout: 30_000 });
  await expect(storefront.locator('.ailoom-message[data-role="ai"]').last()).toContainText(/\S+/, {
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  await saveGif(page, context, 'widget-tour.gif', 16, { fps: 15, width: 1080 });
}

async function login(page: Page): Promise<string> {
  await page.goto(`${PUBLIC_URL}/login`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+/);
  return new URL(page.url()).pathname.replace(/\/$/, '');
}

async function recordHandoffTour(browser: Browser): Promise<void> {
  const { context, page } = await startVideo(browser, 'handoff');
  const hostUrl = `http://localhost:${String(HOST_PORT)}/host.html`;
  const email = 'alex.rivera@northwind.example';
  const reply = 'Hi Alex, I can help with your order. What is your order number?';

  await page.goto(hostUrl);
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.waitForTimeout(1_000);
  await page
    .getByPlaceholder('Type your message…')
    .fill('I need to talk to a human about my order.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, connect me' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Yes, connect me' }).click();
  await page.getByLabel('Your email (optional)').fill(email);
  await page
    .locator('form.ailoom-email')
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  await page.locator('form.ailoom-email').waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForTimeout(900);

  const workspace = await login(page);
  await page.goto(`${PUBLIC_URL}${workspace}/conversations`);
  const row = page.getByRole('row').filter({ hasText: email }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.getByRole('link').click();
  await page.getByText('Needs human').first().waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Take over' }).click();
  await page.getByLabel('Reply to the visitor').fill(reply);
  await page.getByRole('button', { name: 'Send reply' }).click();
  await page.getByText(reply).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);

  await page.goto(hostUrl);
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByText(reply).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_200);
  await saveGif(page, context, 'handoff-tour.gif', 20, { fps: 12, width: 1080 });
}

async function recordAdminTour(browser: Browser): Promise<void> {
  const { context, page } = await startVideo(browser, 'admin');
  const workspace = await login(page);
  await page.getByRole('heading', { name: 'Overview' }).waitFor();
  await page.waitForTimeout(1_200);
  await page.goto(`${PUBLIC_URL}${workspace}/bots`);
  await page.getByRole('heading', { name: 'Bots' }).waitFor();
  const botLink = page.locator('a[href*="/bots/"][href$="/general"]').first();
  await botLink.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  const botHref = await botLink.getAttribute('href');
  if (botHref === null) throw new Error('seeded demo bot was not found');
  await page.goto(`${PUBLIC_URL}${botHref}`);
  await page.getByRole('heading', { name: 'Help Center' }).waitFor();
  await page.waitForTimeout(1_100);

  await page.goto(`${PUBLIC_URL}${workspace}/knowledge`);
  await page.getByRole('heading', { name: 'Knowledge' }).waitFor();
  await page.locator('a[href*="/bots/"][href*="/knowledge"]').first().click();
  await page.getByText('Northwind help center').last().waitFor();
  await page.screenshot({ path: join(OUTPUT, 'screenshot-knowledge.png') });
  await page.waitForTimeout(1_100);

  await page.goto(`${PUBLIC_URL}${workspace}/conversations`);
  await page.getByRole('heading', { name: 'Conversations' }).waitFor();
  await page.screenshot({ path: join(OUTPUT, 'screenshot-inbox.png') });
  await page.waitForTimeout(1_100);

  await page.goto(`${PUBLIC_URL}${workspace}/usage`);
  await page.getByRole('heading', { name: 'Usage' }).waitFor();
  await page.getByRole('button', { name: 'Table view' }).click();
  await page.screenshot({ path: join(OUTPUT, 'screenshot-usage.png') });
  await page.waitForTimeout(1_200);
  await saveGif(page, context, 'admin-tour.gif', 10);
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
    if (request.url === '/editor') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(INTEGRATION_EDITOR);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise<void>((ready) => server.listen(HOST_PORT, '127.0.0.1', ready));

  const browser = await chromium.launch();
  try {
    await recordWidgetTour(browser);
    await recordHandoffTour(browser);
    await recordAdminTour(browser);
  } finally {
    await browser.close();
    server.close();
    await rm(VIDEO_DIR, { recursive: true, force: true });
  }
}

await main();
