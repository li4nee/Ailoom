// SPDX-License-Identifier: AGPL-3.0-only
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { URL } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { crawlPolicy, providerPolicy, safeFetch, type FetchPolicy, type LookupFn } from './index';

const MB = 1024 * 1024;

let server: Server;
let port: number;
/** Paths the local server received, in order (reset before each test). */
let seen: string[] = [];
const socketsByPath = new Map<string, Socket>();

const testConfig = {
  nodeEnv: 'test' as const,
  version: '0.0.0',
  publicUrl: new URL('http://localhost:3000'),
  database: { url: '', listenUrl: '', ssl: false as const, sslCa: null },
  auth: { secrets: [] as Buffer[], accessTokenTtlMin: 15, refreshTokenTtlDays: 30 },
  widgetSecret: Buffer.from('test-widget-secret-min-32-bytes-long'),
  challengeSecret: null,
  encryptionKeys: [{ version: 1, key: Buffer.from('0'.repeat(64), 'hex') }],
  signupMode: 'open' as const,
  email: { transport: 'none' as const },
  productName: 'Test',
  storageDir: '/tmp',
  maxUploadMb: 20,
  crawl: { maxPages: 500, respectRobots: true, userAgent: 'TestCrawler/1.0' },
  providerUrls: { allowPrivate: false, allowlist: [] as string[], denylist: [] as string[] },
  localEmbeddings: true,
  localEmbeddingModel: 'bge-small-en-v1.5' as const,
  logLevel: 'info' as const,
  retention: { conversationsDays: 0, tracesDays: 90, sessionsDays: 90 },
};

const crawl = crawlPolicy(testConfig);
const provider = providerPolicy(testConfig);

/** `public.test` and `other.test` both reach the local server; nothing else resolves. */
const lookup: LookupFn = (host) => {
  if (host === 'public.test' || host === 'other.test' || host === 'ollama') {
    return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
  }
  return Promise.reject(new Error(`no stub for ${host}`));
};

/**
 * The brief's test policy: crawl rules, the local server's port, and `public.test` as the
 * only private-destination exception. Every other private address stays blocked.
 */
let testPolicy: FetchPolicy;

function url(path: string, host = 'public.test'): string {
  return `http://${host}:${String(port)}${path}`;
}

async function closedWithin(socket: Socket | undefined, ms: number): Promise<boolean> {
  if (socket === undefined) return false;
  if (socket.destroyed) return true;
  const timer = new Promise<false>((resolve) =>
    setTimeout(() => {
      resolve(false);
    }, ms),
  );
  const closed = once(socket, 'close').then(() => true as const);
  return Promise.race([closed, timer]);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${String(port)}`);
    seen.push(reqUrl.pathname);
    socketsByPath.set(reqUrl.pathname, req.socket);

    const redirect = /^\/redirect-(30[12378])$/.exec(reqUrl.pathname);
    if (redirect !== null) {
      res.writeHead(Number(redirect[1]), { Location: '/echo' });
      res.end();
      return;
    }

    switch (reqUrl.pathname) {
      case '/ok': {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      case '/big': {
        const size = 6 * MB;
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': String(size) });
        const chunk = Buffer.alloc(1024 * 100, 'x');
        let sent = 0;
        while (sent < size) {
          const toSend = Math.min(chunk.length, size - sent);
          res.write(chunk.subarray(0, toSend));
          sent += toSend;
        }
        res.end();
        return;
      }
      case '/slow': {
        // Never responds.
        return;
      }
      case '/slow-body': {
        // Headers and a first chunk, then the body never ends.
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('partial');
        return;
      }
      case '/redirect-private': {
        res.writeHead(302, { Location: 'http://10.0.0.1/' });
        res.end();
        return;
      }
      case '/redirect-metadata': {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      case '/redirect-ok': {
        res.writeHead(302, { Location: '/ok' });
        res.end();
        return;
      }
      case '/redirect-cross': {
        res.writeHead(302, { Location: `http://other.test:${String(port)}/echo` });
        res.end();
        return;
      }
      case '/redirect-cross-307': {
        res.writeHead(307, { Location: `http://other.test:${String(port)}/echo` });
        res.end();
        return;
      }
      case '/loop': {
        res.writeHead(302, { Location: '/loop' });
        res.end();
        return;
      }
      case '/echo': {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(
            JSON.stringify({
              method: req.method,
              body: Buffer.concat(chunks).toString(),
              contentType: req.headers['content-type'] ?? null,
              authorization: req.headers.authorization ?? null,
              cookie: req.headers.cookie ?? null,
              proxyAuthorization: req.headers['proxy-authorization'] ?? null,
              custom: req.headers['x-custom'] ?? null,
            }),
          );
        });
        return;
      }
      case '/pdf': {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end('%PDF-1.4 test');
        return;
      }
      case '/exe': {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end('MZ');
        return;
      }
      case '/ua': {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(req.headers['user-agent'] ?? '');
        return;
      }
      default: {
        res.writeHead(404);
        res.end('not found');
      }
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as AddressInfo).port;
  testPolicy = { ...crawl, allowHosts: ['public.test'], allowedPorts: [port] };
}, 10_000);

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  seen = [];
  socketsByPath.clear();
});

const failingLookup: LookupFn = () => Promise.reject(new Error('DNS must not be used'));

describe('safeFetch: address and host policy', () => {
  it('blocks private targets for crawl', async () => {
    await expect(safeFetch('http://10.0.0.5/', {}, crawl)).rejects.toMatchObject({
      code: 'blocked_address',
    });
  });

  it('blocks loopback via decimal ip', async () => {
    await expect(safeFetch('http://2130706433/', {}, crawl)).rejects.toMatchObject({
      code: 'blocked_address',
    });
  });

  it('blocks metadata even when private is allowed', async () => {
    await expect(
      safeFetch('http://169.254.169.254/latest', {}, { ...provider, allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('blocks compose service names for providers', async () => {
    await expect(
      safeFetch('http://postgres:5432/', {}, { ...provider, allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'blocked_host' });
  });

  it.each(['http://postgres./', 'http://POSTGRES/', 'http://Postgres.:5432/'])(
    '%s is blocked_host for providers (case and trailing dot normalized)',
    async (raw) => {
      await expect(
        safeFetch(raw, {}, { ...provider, allowPrivate: true }, { lookup: failingLookup }),
      ).rejects.toMatchObject({ code: 'blocked_host' });
    },
  );

  it.each(['http://x.metadata.google.internal/', 'http://a.b.metadata.google.internal./'])(
    '%s subdomain of a denied host is blocked_host',
    async (raw) => {
      await expect(
        safeFetch(raw, {}, { ...provider, allowPrivate: true }, { lookup: failingLookup }),
      ).rejects.toMatchObject({ code: 'blocked_host' });
    },
  );

  it.each(['http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00:ec2::254]/'])(
    '%s IPv6 literal is blocked_address without a DNS lookup',
    async (raw) => {
      await expect(safeFetch(raw, {}, crawl, { lookup: failingLookup })).rejects.toMatchObject({
        code: 'blocked_address',
      });
    },
  );

  it('blocks the IPv4-compatible literal ::127.0.0.1 even with allowPrivate', async () => {
    await expect(
      safeFetch('http://[::127.0.0.1]/', {}, { ...provider, allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('blocks link-local (ECS credentials 169.254.170.2) even with allowPrivate', async () => {
    await expect(
      safeFetch('http://169.254.170.2/v2/credentials', {}, { ...provider, allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
  });

  it('blocks non-allowed ports for crawl', async () => {
    await expect(
      safeFetch('http://public.test:8081/ok', {}, crawl, { lookup }),
    ).rejects.toMatchObject({ code: 'blocked_port' });
  });

  it('blocks hosts whose DNS returns any private address', async () => {
    const mixed: LookupFn = () =>
      Promise.resolve([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]);
    await expect(
      safeFetch('http://mixed.test/', {}, crawl, { lookup: mixed }),
    ).rejects.toMatchObject({ code: 'blocked_address' });
  });

  describe('loopback ruling: only an explicit allowHosts entry reaches loopback', () => {
    it('(a) allowPrivate with an empty allowlist blocks http://127.0.0.1', async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: [] };
      await expect(
        safeFetch(`http://127.0.0.1:${String(port)}/ok`, {}, policy),
      ).rejects.toMatchObject({ code: 'blocked_address' });
      expect(seen).toEqual([]);
    });

    it("(b) allowPrivate with allowHosts ['127.0.0.1'] is allowed", async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['127.0.0.1'] };
      const res = await safeFetch(`http://127.0.0.1:${String(port)}/ok`, {}, policy);
      expect(await res.text()).toBe('ok');
    });

    it('(c) a listed hostname resolving to 127.0.0.1 is allowed', async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['public.test'] };
      const res = await safeFetch(url('/ok'), {}, policy, { lookup });
      expect(await res.text()).toBe('ok');
    });

    it('(c) an unlisted hostname resolving to 127.0.0.1 is blocked', async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: [] };
      await expect(safeFetch(url('/ok'), {}, policy, { lookup })).rejects.toMatchObject({
        code: 'blocked_address',
      });
      expect(seen).toEqual([]);
    });

    it.each(['http://127.0.0.1:PORT/ok', 'http://[::1]:PORT/ok', 'http://public.test:PORT/ok'])(
      '(d) providerPolicy with allowPrivate true still blocks loopback: %s',
      async (raw) => {
        const policy = providerPolicy({
          ...testConfig,
          providerUrls: { allowPrivate: true, allowlist: [], denylist: [] },
        });
        expect(policy.allowPrivate).toBe(true);
        await expect(
          safeFetch(raw.replace('PORT', String(port)), {}, policy, { lookup }),
        ).rejects.toMatchObject({ code: 'blocked_address' });
        expect(seen).toEqual([]);
      },
    );
  });

  describe('allowHosts with allowPrivate', () => {
    it("allows the listed IP literal (['127.0.0.1'])", async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['127.0.0.1'] };
      const res = await safeFetch(`http://127.0.0.1:${String(port)}/ok`, {}, policy);
      expect(await res.text()).toBe('ok');
    });

    it("blocks an unlisted private IP literal (['127.0.0.2'] → 127.0.0.1)", async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['127.0.0.2'] };
      await expect(
        safeFetch(`http://127.0.0.1:${String(port)}/ok`, {}, policy),
      ).rejects.toMatchObject({ code: 'blocked_address' });
      expect(seen).toEqual([]);
    });

    it('allows a listed CIDR', async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['127.0.0.0/8'] };
      const res = await safeFetch(`http://127.0.0.1:${String(port)}/ok`, {}, policy);
      expect(await res.text()).toBe('ok');
    });

    it("allows host ollama resolving to a private address (['ollama'])", async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['ollama'] };
      const res = await safeFetch(url('/ok', 'ollama'), {}, policy, { lookup });
      expect(await res.text()).toBe('ok');
    });

    it("blocks another host resolving to a private address (['ollama'])", async () => {
      const policy = { ...provider, allowPrivate: true, allowHosts: ['ollama'] };
      await expect(
        safeFetch(url('/ok', 'other.test'), {}, policy, { lookup }),
      ).rejects.toMatchObject({ code: 'blocked_address' });
    });
  });
});

describe('safeFetch: connection', () => {
  it('connects to the pinned address', async () => {
    const pinned = vi
      .fn<LookupFn>()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '10.9.9.9', family: 4 }]);
    const res = await safeFetch(url('/ok'), {}, testPolicy, { lookup: pinned });
    expect(await res.text()).toBe('ok');
    expect(pinned).toHaveBeenCalledTimes(1);
  });

  it('sends the policy user agent', async () => {
    const res = await safeFetch(url('/ua'), {}, testPolicy, { lookup });
    expect(await res.text()).toBe(testPolicy.userAgent);
  });

  it('closes the connection once the body has been read', async () => {
    const res = await safeFetch(url('/ok'), {}, testPolicy, { lookup });
    expect(await res.text()).toBe('ok');
    expect(await closedWithin(socketsByPath.get('/ok'), 1000)).toBe(true);
  });

  it('closes the connection when the caller cancels the body', async () => {
    const res = await safeFetch(url('/slow-body'), {}, testPolicy, { lookup });
    await res.body?.cancel();
    expect(await closedWithin(socketsByPath.get('/slow-body'), 1000)).toBe(true);
  });
});

describe('safeFetch: redirects', () => {
  it('re-validates every redirect hop (second hop to a private address)', async () => {
    // Port 80 is allowed so the second hop fails on its address, not its port.
    const policy = { ...testPolicy, allowedPorts: [port, 80] };
    await expect(safeFetch(url('/redirect-private'), {}, policy, { lookup })).rejects.toMatchObject(
      { code: 'blocked_address' },
    );
    // Hop 1 was allowed and served; the rejection came from hop 2.
    expect(seen).toEqual(['/redirect-private']);
  });

  it('re-validates every redirect hop (second hop to metadata)', async () => {
    await expect(
      safeFetch(
        url('/redirect-metadata'),
        {},
        { ...testPolicy, allowPrivate: true, allowedPorts: [port, 80] },
        { lookup },
      ),
    ).rejects.toMatchObject({ code: 'blocked_address' });
    expect(seen).toEqual(['/redirect-metadata']);
  });

  it('follows safe redirects', async () => {
    const res = await safeFetch(url('/redirect-ok'), {}, testPolicy, { lookup });
    expect(await res.text()).toBe('ok');
    expect(seen).toEqual(['/redirect-ok', '/ok']);
  });

  it('stops at maxRedirects', async () => {
    await expect(safeFetch(url('/loop'), {}, testPolicy, { lookup })).rejects.toMatchObject({
      code: 'too_many_redirects',
    });
    expect(seen).toHaveLength(testPolicy.maxRedirects + 1);
  });

  const post = {
    method: 'POST',
    body: 'payload',
    headers: { 'content-type': 'application/json', 'x-custom': 'kept' },
  };

  it.each(['301', '302', '303'])('%s after POST switches to GET without a body', async (code) => {
    const res = await safeFetch(url(`/redirect-${code}`), post, testPolicy, { lookup });
    const echo = (await res.json()) as Record<string, unknown>;
    expect(echo).toMatchObject({ method: 'GET', body: '', contentType: null, custom: 'kept' });
  });

  it('303 after PUT switches to GET without a body', async () => {
    const res = await safeFetch(url('/redirect-303'), { ...post, method: 'PUT' }, testPolicy, {
      lookup,
    });
    expect(await res.json()).toMatchObject({ method: 'GET', body: '' });
  });

  it.each(['307', '308'])('%s keeps the method and body', async (code) => {
    const res = await safeFetch(url(`/redirect-${code}`), post, testPolicy, { lookup });
    expect(await res.json()).toMatchObject({
      method: 'POST',
      body: 'payload',
      contentType: 'application/json',
    });
  });

  const credentials = {
    headers: {
      Authorization: 'Bearer secret',
      Cookie: 'session=abc',
      'Proxy-Authorization': 'Basic xyz',
      'X-Custom': 'kept',
    },
  };

  it('keeps credentials on a same-origin redirect', async () => {
    const res = await safeFetch(url('/redirect-302'), credentials, testPolicy, { lookup });
    expect(await res.json()).toMatchObject({
      authorization: 'Bearer secret',
      cookie: 'session=abc',
      proxyAuthorization: 'Basic xyz',
    });
  });

  it.each(['/redirect-cross', '/redirect-cross-307'])(
    '%s strips Authorization, Cookie and Proxy-Authorization cross-origin',
    async (path) => {
      const policy = { ...testPolicy, allowHosts: ['public.test', 'other.test'] };
      const res = await safeFetch(url(path), credentials, policy, { lookup });
      expect(await res.json()).toMatchObject({
        authorization: null,
        cookie: null,
        proxyAuthorization: null,
        custom: 'kept',
      });
      expect(seen).toEqual([path, '/echo']);
    },
  );
});

describe('safeFetch: response limits', () => {
  it('enforces size while streaming', async () => {
    const res = await safeFetch(url('/big'), {}, { ...testPolicy, maxBytes: 1 * MB }, { lookup });
    await expect(res.arrayBuffer()).rejects.toMatchObject({ code: 'too_large' });
  });

  it('times out', async () => {
    await expect(
      safeFetch(url('/slow'), {}, { ...testPolicy, totalTimeoutMs: 200 }, { lookup }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('times out while reading the body', async () => {
    const res = await safeFetch(
      url('/slow-body'),
      {},
      { ...testPolicy, totalTimeoutMs: 300 },
      {
        lookup,
      },
    );
    await expect(res.text()).rejects.toMatchObject({ code: 'timeout' });
  });

  it("propagates the caller's abort reason (not 'timeout')", async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    setTimeout(() => {
      controller.abort(reason);
    }, 50);
    await expect(
      safeFetch(url('/slow'), { signal: controller.signal }, testPolicy, { lookup }),
    ).rejects.toBe(reason);
  });

  it("propagates the caller's abort reason during the body read", async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const res = await safeFetch(url('/slow-body'), { signal: controller.signal }, testPolicy, {
      lookup,
    });
    setTimeout(() => {
      controller.abort(reason);
    }, 50);
    await expect(res.text()).rejects.toBe(reason);
  });

  it('enforces content types: safeFetch itself rejects', async () => {
    await expect(safeFetch(url('/exe'), {}, testPolicy, { lookup })).rejects.toMatchObject({
      code: 'bad_content_type',
    });
    expect(await closedWithin(socketsByPath.get('/exe'), 1000)).toBe(true);
  });

  it('accepts an allowed content type', async () => {
    const res = await safeFetch(url('/pdf'), {}, testPolicy, { lookup });
    expect(await res.text()).toBe('%PDF-1.4 test');
  });
});
