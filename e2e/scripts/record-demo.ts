// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Record focused README showcase clips and labeled screenshots against a fresh seeded stack.
 *
 *   SHOWCASE_ONLY=all PUBLIC_URL=http://localhost:18092 DEMO_ADMIN_URL=http://localhost:15174 HOST_PORT=8090 \
 *     pnpm --filter @app/e2e exec node --experimental-strip-types scripts/record-demo.ts
 *
 * Requires Node.js 24, ffmpeg, Chromium, and a running demo stack seeded with the Northwind data.
 * Set SHOWCASE_ONLY to operations, interactions, knowledge, insights, answers, handoff, or trace
 * to record selected flows. Writes showcase GIFs and labeled screenshots under docs/assets;
 * existing launch-tour assets are left untouched.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'http://localhost:18090';
const ADMIN_URL = process.env['DEMO_ADMIN_URL'] ?? PUBLIC_URL;
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
  storageState?: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: join(VIDEO_DIR, name), size: VIEWPORT },
    ...(storageState === undefined ? {} : { storageState }),
  });
  return { context, page: await context.newPage() };
}

async function addShowcaseLabel(page: Page, section: string, detail: string): Promise<void> {
  await page.evaluate(
    ({ sectionText, detailText }) => {
      let label = document.querySelector<HTMLDivElement>('[data-showcase-label]');
      if (label === null) {
        label = document.createElement('div');
        label.dataset['showcaseLabel'] = 'true';
        label.setAttribute('aria-hidden', 'true');
        Object.assign(label.style, {
          position: 'fixed',
          zIndex: '2147483647',
          left: '28px',
          bottom: '28px',
          maxWidth: '520px',
          padding: '14px 18px',
          border: '1px solid rgba(255,255,255,.16)',
          borderRadius: '12px',
          background: 'rgba(20,30,24,.95)',
          color: '#fff',
          boxShadow: '0 10px 32px rgba(0,0,0,.2)',
          font: '500 18px/1.4 Inter, ui-sans-serif, system-ui, sans-serif',
          pointerEvents: 'none',
        });
        const section = document.createElement('div');
        section.dataset['showcaseSection'] = 'true';
        Object.assign(section.style, {
          marginBottom: '3px',
          color: '#c8f27b',
          fontSize: '13px',
          fontWeight: '750',
          letterSpacing: '.1em',
          textTransform: 'uppercase',
        });
        const detail = document.createElement('div');
        detail.dataset['showcaseDetail'] = 'true';
        detail.style.fontSize = '18px';
        label.append(section, detail);
        document.body.append(label);
      }
      const section = label.querySelector<HTMLElement>('[data-showcase-section]');
      const detail = label.querySelector<HTMLElement>('[data-showcase-detail]');
      if (section !== null) section.textContent = sectionText;
      if (detail !== null) detail.textContent = detailText;
    },
    { sectionText: section, detailText: detail },
  );
}

async function loginState(browser: Browser): Promise<{
  workspace: string;
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const workspace = await login(page);
  const storageState = await context.storageState();
  await context.close();
  return { workspace, storageState };
}

async function saveGif(
  page: Page,
  context: BrowserContext,
  filename: string,
  seconds: number,
  options: { fps?: number; width?: number } = {},
): Promise<void> {
  const fps = options.fps ?? 8;
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
  await addShowcaseLabel(page, '01 · SEE THE WIDGET', 'A sample support widget on a storefront');
  await storefront.waitForTimeout(1_200);
  await storefront.getByRole('button', { name: 'Open chat' }).click();
  await storefront.waitForTimeout(1_200);
  const composer = storefront.getByPlaceholder('Type your message…');
  await composer.click();
  await composer.pressSequentially('What is your return policy?', { delay: 32 });
  await addShowcaseLabel(
    page,
    '02 · SAMPLE RESPONSE',
    'This seeded demo uses the deterministic mock chat provider',
  );
  await page.waitForTimeout(1_200);
  await storefront.getByRole('button', { name: 'Send', exact: true }).click();
  await storefront
    .locator('.ailoom-message[data-role="visitor"]')
    .last()
    .waitFor({ timeout: 30_000 });
  await expect(storefront.locator('.ailoom-message[data-role="ai"]').last()).toContainText(/\S+/, {
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-answer.png') });
  await saveGif(page, context, 'showcase-answer.gif', 12, { fps: 6, width: 800 });
}

async function login(page: Page): Promise<string> {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+/);
  return new URL(page.url()).pathname.replace(/\/$/, '');
}

async function recordHandoffTour(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'handoff');
  const hostUrl = `http://localhost:${String(HOST_PORT)}/host.html`;
  const email = `alex+${String(Date.now()).slice(-3)}@nw.example`;
  const reply = 'Hi Alex, I can help with your order. What is your order number?';

  await page.goto(hostUrl);
  await page.getByRole('button', { name: 'Open chat' }).waitFor({ timeout: 30_000 });
  await addShowcaseLabel(
    page,
    '01 · HUMAN HANDOFF',
    'A visitor asks to speak with the support team',
  );
  await page.waitForTimeout(1_200);
  await page.getByRole('button', { name: 'Open chat' }).click();
  const composer = page.getByPlaceholder('Type your message…');
  await composer.click();
  await composer.pressSequentially('I need to talk to a human about my order.', { delay: 20 });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, connect me' }).waitFor({ timeout: 30_000 });
  await addShowcaseLabel(
    page,
    '02 · CONFIRM THE HANDOFF',
    'The visitor chooses to continue with a person',
  );
  await page.waitForTimeout(1_800);
  await page.getByRole('button', { name: 'Yes, connect me' }).click();
  await addShowcaseLabel(
    page,
    '03 · OPTIONAL CONTACT',
    'The visitor can share an email for the reply',
  );
  await page.locator('form.ailoom-email').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(1_800);
  await page.getByLabel('Your email (optional)').fill(email);
  await page
    .locator('form.ailoom-email')
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  await page.locator('form.ailoom-email').waitFor({ state: 'detached', timeout: 30_000 });
  await addShowcaseLabel(page, '04 · TEAM INBOX', 'The request is ready for an agent');
  await page.waitForTimeout(1_600);

  const agentContext = await browser.newContext({
    storageState,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const agentPage = await agentContext.newPage();
  await agentPage.goto(`${ADMIN_URL}${workspace}/conversations`);
  const row = agentPage.getByRole('row').filter({ hasText: email }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.getByRole('link').click();
  await agentPage.getByText('Needs human').first().waitFor({ timeout: 30_000 });
  await agentPage.screenshot({ path: join(OUTPUT, 'screenshot-showcase-inbox.png') });
  const takeOver = agentPage.getByRole('button', { name: 'Take over' });
  if (await takeOver.isVisible().catch(() => false)) await takeOver.click();
  await agentPage.getByLabel('Reply to the visitor').fill(reply);
  await agentPage.getByRole('button', { name: 'Send reply' }).click();
  await expect(agentPage.getByRole('textbox', { name: 'Reply to the visitor' })).toHaveValue('', {
    timeout: 30_000,
  });
  await addShowcaseLabel(agentPage, '05 · AGENT REPLY', 'The reply is sent in the same thread');
  await agentPage.getByText(reply, { exact: true }).last().scrollIntoViewIfNeeded();
  await agentPage.screenshot({ path: join(OUTPUT, 'screenshot-showcase-agent-reply.png') });
  await page.waitForTimeout(1_200);

  await page.goto(hostUrl);
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByText(reply).waitFor({ timeout: 30_000 });
  await addShowcaseLabel(
    page,
    '06 · HUMAN REPLY',
    'The answer returns to the visitor without leaving chat',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-handoff.png') });
  await page.waitForTimeout(2_500);
  await agentContext.close();
  await saveGif(page, context, 'showcase-handoff.gif', 16, { fps: 6, width: 800 });
}

function botId(workspace: string, path: string): string {
  const match = new RegExp(`${workspace}/bots/([0-9a-f-]+)/`).exec(path);
  if (match?.[1] === undefined) throw new Error('The seeded demo bot was not found.');
  return match[1];
}

async function recordKnowledgeTour(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'knowledge', storageState);
  await page.goto(`${ADMIN_URL}${workspace}/knowledge`);
  await page.getByRole('heading', { name: 'Knowledge', exact: true }).waitFor();
  const knowledgeLink = page.locator('a[href*="/bots/"][href$="/knowledge"]').first();
  await knowledgeLink.waitFor({ state: 'visible' });
  const knowledgePath = await knowledgeLink.getAttribute('href');
  if (knowledgePath === null) throw new Error('The seeded demo knowledge page was not found.');
  const id = botId(workspace, knowledgePath);
  await page.goto(`${ADMIN_URL}${workspace}/bots/${id}/knowledge`);
  await page.getByText('Northwind help center').last().waitFor();
  await addShowcaseLabel(
    page,
    '01 · KNOWLEDGE BASE',
    'Keep approved support content ready to search',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-knowledge.png') });
  await page.waitForTimeout(1_800);

  await page.getByRole('link', { name: 'Test retrieval' }).click();
  await page.getByRole('heading', { name: 'Test retrieval' }).waitFor();
  await page.locator('#test-retrieval-query').fill('How many days do I have to return an item?');
  await addShowcaseLabel(
    page,
    '02 · TEST RETRIEVAL',
    'Check the passages that will ground an answer',
  );
  await page.getByRole('button', { name: 'Search' }).click();
  await page
    .getByRole('table')
    .getByText(/Northwind Outfitters accepts returns within 30 days/)
    .waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-retrieval.png') });
  await page.waitForTimeout(2_800);
  await saveGif(page, context, 'showcase-knowledge.gif', 10, { fps: 6, width: 800 });
}

async function recordOperationsTour(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'operations', storageState);
  await page.goto(`${ADMIN_URL}${workspace}/settings/operations`);
  await page.getByRole('heading', { name: 'Agent operations' }).waitFor();
  await page.locator('#agent-presence').selectOption('online');
  const autoAssign = page.getByLabel('Automatically assign human handoffs');
  if (!(await autoAssign.isChecked())) await autoAssign.check();
  await page.getByLabel('Assignment strategy').selectOption('least_loaded');
  await page.locator('#routing-capacity').fill('8');
  await page.locator('#sla-response-normal').fill('15');
  await page.locator('#sla-resolution-normal').fill('120');
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await addShowcaseLabel(
    page,
    '01 · AVAILABILITY & ROUTING',
    'Set agent presence, least-loaded assignment, and capacity',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-operations.png') });
  await page.waitForTimeout(1_500);
  await page.locator('#sla-response-normal').scrollIntoViewIfNeeded();
  await addShowcaseLabel(
    page,
    '02 · SERVICE TARGETS',
    'Set response and resolution goals for human handoffs',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-sla.png') });
  await page.waitForTimeout(1_800);
  await page.getByRole('button', { name: 'Save operations settings' }).click();
  await page.getByText('Operations settings saved.').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await saveGif(page, context, 'showcase-agent-operations.gif', 10, { fps: 6, width: 800 });
}

async function recordInboxOverview(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'inbox-overview', storageState);
  await page.goto(`${ADMIN_URL}${workspace}/conversations`);
  await page
    .getByRole('heading', { name: /inbox|conversations/i })
    .first()
    .waitFor();
  await page.getByRole('row').nth(1).waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({ path: join(OUTPUT, 'screenshot-inbox.png') });
  await context.close();
}

async function recordInsightsTour(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'insights', storageState);
  await page.goto(`${ADMIN_URL}${workspace}/usage/usage`);
  await page.getByRole('heading', { name: 'Usage' }).waitFor();
  await page.getByRole('button', { name: 'Table view' }).click();
  await addShowcaseLabel(
    page,
    '01 · USAGE & OUTCOMES',
    'Review volume, feedback, token use, and cost',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-usage.png') });
  await page.waitForTimeout(2_000);

  await page.goto(`${ADMIN_URL}${workspace}/usage/knowledge-gaps`);
  await page.getByRole('heading', { name: 'Knowledge gaps' }).waitFor();
  await page
    .getByText('do you repair a jacket after the two-year warranty has ended', { exact: true })
    .waitFor({ timeout: 30_000 });
  await addShowcaseLabel(
    page,
    '02 · KNOWLEDGE GAPS',
    'Find repeat questions that need better source coverage',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-insights.png') });
  await page.waitForTimeout(2_500);
  await saveGif(page, context, 'showcase-insights.gif', 10, { fps: 6, width: 800 });
}

async function recordInteractionsTour(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'interactions', storageState);
  await page.goto(`${ADMIN_URL}${workspace}/bots`);
  const botLink = page.locator('a[href*="/bots/"][href$="/general"]').first();
  await botLink.waitFor({ state: 'visible' });
  const botPath = await botLink.getAttribute('href');
  if (botPath === null) throw new Error('The seeded demo bot was not found.');
  const id = botId(workspace, botPath);
  await page.goto(`${ADMIN_URL}${workspace}/bots/${id}/interactions`);
  await page.getByRole('heading', { name: 'Welcome interactions' }).waitFor();

  const cards = page.getByRole('group', { name: 'Cards' });
  await cards.getByLabel('Title').first().waitFor({ state: 'visible', timeout: 30_000 });
  while ((await cards.getByRole('button', { name: 'Remove card' }).count()) > 0) {
    await cards.getByRole('button', { name: 'Remove card' }).first().click();
  }
  await page.getByRole('button', { name: 'Add card' }).click();
  await cards.getByLabel('Title').nth(0).fill('Easy returns');
  await cards
    .getByLabel('Description', { exact: true })
    .nth(0)
    .fill('See the return window and item requirements.');
  await cards
    .getByLabel('Destination (HTTPS)')
    .nth(0)
    .fill('https://northwindoutfitters.example/help/returns');
  await cards.getByLabel('Link label').nth(0).fill('Return policy');
  await page.getByRole('button', { name: 'Add card' }).click();
  await cards.getByLabel('Title').nth(1).fill('Shipping details');
  await cards
    .getByLabel('Description', { exact: true })
    .nth(1)
    .fill('Check delivery options and expected timing.');
  await cards
    .getByLabel('Destination (HTTPS)')
    .nth(1)
    .fill('https://northwindoutfitters.example/help/shipping');
  await cards.getByLabel('Link label').nth(1).fill('Shipping policy');

  const replies = page.getByRole('group', { name: 'Quick replies' });
  while ((await replies.getByRole('button', { name: 'Remove', exact: true }).count()) > 0) {
    await replies.getByRole('button', { name: 'Remove', exact: true }).first().click();
  }
  await page.getByRole('button', { name: 'Add quick reply' }).click();
  await replies.getByLabel('Button label').fill('Delivery times');
  await replies.getByLabel('Message sent').fill('How long does delivery take?');
  await page.getByRole('button', { name: 'Add quick reply' }).click();
  await replies.getByLabel('Button label').nth(1).fill('Return an item');
  await replies.getByLabel('Message sent').nth(1).fill('What is your return policy?');

  const form = page.getByRole('group', { name: 'Support form' });
  if (await form.getByRole('button', { name: 'Remove form' }).isVisible()) {
    await form.getByRole('button', { name: 'Remove form' }).click();
  }
  await form.getByRole('button', { name: 'Add form' }).click();
  await form.getByLabel('Form title').fill('Ask our support team');
  await form
    .getByLabel('Description')
    .fill('Tell us what you need. Please do not include payment details.');
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await addShowcaseLabel(
    page,
    '01 · ADMIN-AUTHORED WELCOME',
    'Choose which links, replies, and fields visitors see',
  );
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-interactions.png') });
  await form.getByLabel('Form title').scrollIntoViewIfNeeded();
  await addShowcaseLabel(
    page,
    '02 · BOUNDED SUPPORT FORM',
    'Admins choose the fields and visitor copy',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-interaction-form.png') });
  await page.waitForTimeout(1_200);
  await page.getByRole('button', { name: 'Save interactions' }).click();
  await page.getByRole('status').getByText('Saved.', { exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_200);

  await page.goto(`http://localhost:${String(HOST_PORT)}/host.html`);
  await page.getByRole('button', { name: 'Open chat' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByRole('region', { name: 'Helpful links carousel' }).waitFor({ timeout: 30_000 });
  await addShowcaseLabel(
    page,
    '03 · VISITOR WELCOME',
    'Visitors can browse links, choose a reply, or send a bounded request',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-widget-interactions.png') });
  await page.waitForTimeout(3_000);
  await page.getByRole('button', { name: 'Delivery times' }).click();
  await expect(page.locator('.ailoom-message[data-role="visitor"]').last()).toContainText(
    'How long does delivery take?',
  );
  await expect(page.locator('.ailoom-message[data-role="ai"]').last()).toContainText(/\S+/, {
    timeout: 30_000,
  });
  await addShowcaseLabel(
    page,
    '04 · QUICK REPLY',
    'A suggested question follows the normal visitor-message path',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-quick-reply.png') });
  await page.waitForTimeout(3_000);
  await saveGif(page, context, 'showcase-widget-interactions.gif', 15, { fps: 6, width: 800 });
}

async function recordTraceTour(
  browser: Browser,
  workspace: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<void> {
  const { context, page } = await startVideo(browser, 'trace', storageState);
  await page.goto(`${ADMIN_URL}${workspace}/conversations`);
  const answerRow = page
    .getByRole('row')
    .filter({ hasText: 'Express shipping costs $15 and arrives in 1 to 2 business days.' })
    .first();
  await answerRow.waitFor({ state: 'visible', timeout: 30_000 });
  await answerRow.getByRole('link').click();
  await page.getByRole('button', { name: 'Answer details' }).first().click();
  await page.getByRole('dialog', { name: 'Answer details' }).waitFor();
  await page.getByText('Retrieved sources', { exact: true }).waitFor();
  await addShowcaseLabel(
    page,
    'ANSWER TRACE',
    'Inspect the cited source, retrieval score, model, cost, and latency',
  );
  await page.screenshot({ path: join(OUTPUT, 'screenshot-showcase-answer-trace.png') });
  await page.waitForTimeout(4_500);
  await saveGif(page, context, 'showcase-answer-trace.gif', 8, { fps: 6, width: 800 });
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
    const { workspace, storageState } = await loginState(browser);
    const selected = new Set((process.env['SHOWCASE_ONLY'] ?? 'all').split(','));
    if (selected.has('all') || selected.has('inbox'))
      await recordInboxOverview(browser, workspace, storageState);
    if (selected.has('all') || selected.has('operations'))
      await recordOperationsTour(browser, workspace, storageState);
    if (selected.has('all') || selected.has('interactions'))
      await recordInteractionsTour(browser, workspace, storageState);
    if (selected.has('all') || selected.has('knowledge'))
      await recordKnowledgeTour(browser, workspace, storageState);
    if (selected.has('all') || selected.has('insights'))
      await recordInsightsTour(browser, workspace, storageState);
    if (selected.has('all') || selected.has('answers')) await recordWidgetTour(browser);
    if (selected.has('all') || selected.has('handoff'))
      await recordHandoffTour(browser, workspace, storageState);
    if (selected.has('all') || selected.has('trace'))
      await recordTraceTour(browser, workspace, storageState);
  } finally {
    await browser.close();
    server.close();
    await rm(VIDEO_DIR, { recursive: true, force: true });
  }
}

await main();
