// SPDX-License-Identifier: AGPL-3.0-only
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crawlPolicy, providerPolicy, safeFetch } from './index';

const MB = 1024 * 1024;

let server: Server;
let serverPort: number;

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
  storageDir: '/tmp',
  maxUploadMb: 20,
  crawl: { maxPages: 500, respectRobots: true, userAgent: 'TestCrawler/1.0' },
  providerUrls: { allowPrivate: false, allowlist: [] as string[], denylist: [] as string[] },
  localEmbeddings: true,
  logLevel: 'info' as const,
  retention: { conversationsDays: 0, tracesDays: 90 },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(serverPort)}`);

    switch (url.pathname) {
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
        // Never responds - timeout test
        return;
      }
      case '/redirect-private': {
        res.writeHead(302, { Location: 'http://10.0.0.1/' });
        res.end();
        return;
      }
      case '/redirect-ok': {
        res.writeHead(302, { Location: '/ok' });
        res.end();
        return;
      }
      case '/loop': {
        res.writeHead(302, { Location: '/loop' });
        res.end();
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
  serverPort = (server.address() as AddressInfo).port;
}, 10000);

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const createLookupStub = (
  addresses: Map<string, string[]>,
): ((host: string) => Promise<{ address: string; family: 4 | 6 }[]>) => {
  return (host: string): Promise<{ address: string; family: 4 | 6 }[]> => {
    const ips = addresses.get(host) ?? [];
    return Promise.resolve(ips.map((address) => ({ address, family: 4 })));
  };
};

describe('safeFetch integration', () => {
  const crawlPolicyTest = crawlPolicy(testConfig);
  const providerPolicyTest = providerPolicy(testConfig);

  describe('blocks private targets for crawl', () => {
    it('blocks http://10.0.0.5/', async () => {
      const lookup = createLookupStub(new Map([['10.0.0.5', ['10.0.0.5']]]));
      const policy = { ...crawlPolicyTest, allowPrivate: false, allowHosts: ['10.0.0.5'] };
      await expect(safeFetch('http://10.0.0.5/', {}, policy, { lookup })).rejects.toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });
  });

  describe('blocks loopback via decimal ip', () => {
    it('blocks http://2130706433/', async () => {
      const lookup = createLookupStub(new Map([['2130706433', ['127.0.0.1']]]));
      const policy = { ...crawlPolicyTest, allowPrivate: false, allowHosts: ['2130706433'] };
      await expect(safeFetch('http://2130706433/', {}, policy, { lookup })).rejects.toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });
  });

  describe('blocks metadata even when private allowed', () => {
    it('blocks http://169.254.169.254/latest', async () => {
      const lookup = createLookupStub(new Map([['169.254.169.254', ['169.254.169.254']]]));
      const policy = { ...providerPolicyTest, allowPrivate: true, allowHosts: ['169.254.169.254'] };
      await expect(
        safeFetch('http://169.254.169.254/latest', {}, policy, { lookup }),
      ).rejects.toThrow(expect.objectContaining({ code: 'blocked_address' }));
    });
  });

  describe('blocks compose service names for providers', () => {
    it('blocks http://postgres:5432/', async () => {
      const lookup = createLookupStub(new Map([['postgres', ['127.0.0.1']]]));
      const policy = { ...providerPolicyTest, allowPrivate: true, allowHosts: ['postgres'] };
      await expect(safeFetch('http://postgres:5432/', {}, policy, { lookup })).rejects.toThrow(
        expect.objectContaining({ code: 'blocked_host' }),
      );
    });
  });

  describe('blocks non-allowed ports for crawl', () => {
    it('blocks http://public.test:8081/ok', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const policy = { ...crawlPolicyTest, allowHosts: ['public.test'], allowedPorts: [80, 443] };
      await expect(safeFetch('http://public.test:8081/ok', {}, policy, { lookup })).rejects.toThrow(
        expect.objectContaining({ code: 'blocked_port' }),
      );
    });
  });

  describe('connects to the pinned address', () => {
    it('uses lookup result and calls lookup once', async () => {
      let lookupCallCount = 0;
      const lookup = (): Promise<{ address: string; family: 4 | 6 }[]> => {
        lookupCallCount++;
        if (lookupCallCount === 1) {
          return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
        }
        return Promise.resolve([{ address: '10.9.9.9', family: 4 }]);
      };
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
      };
      const res = await safeFetch(`http://public.test:${String(serverPort)}/ok`, {}, policy, {
        lookup,
      });
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe('ok');
      expect(lookupCallCount).toBe(1);
    });
  });

  describe('re-validates every redirect hop', () => {
    it('blocks redirect to private address', async () => {
      const lookup = createLookupStub(
        new Map([
          ['public.test', [`127.0.0.1`]],
          ['10.0.0.1', ['10.0.0.1']],
        ]),
      );
      const policy = {
        ...crawlPolicyTest,
        allowHosts: ['public.test', '10.0.0.1'],
        allowedPorts: [serverPort, 80],
      };
      await expect(
        safeFetch(`http://public.test:${String(serverPort)}/redirect-private`, {}, policy, {
          lookup,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'blocked_address' }));
    });
  });

  describe('follows safe redirects', () => {
    it('follows redirect to /ok', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
      };
      const res = await safeFetch(
        `http://public.test:${String(serverPort)}/redirect-ok`,
        {},
        policy,
        { lookup },
      );
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe('ok');
    });
  });

  describe('stops at maxRedirects', () => {
    it('throws too_many_redirects on loop', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
        maxRedirects: 5,
      };
      await expect(
        safeFetch(`http://public.test:${String(serverPort)}/loop`, {}, policy, { lookup }),
      ).rejects.toThrow(expect.objectContaining({ code: 'too_many_redirects' }));
    });
  });

  describe('enforces size while streaming', () => {
    it('throws too_large when reading body exceeds maxBytes', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
        maxBytes: 1 * MB,
      };
      const res = await safeFetch(`http://public.test:${String(serverPort)}/big`, {}, policy, {
        lookup,
      });
      expect(res.ok).toBe(true);
      await expect(res.arrayBuffer()).rejects.toThrow(
        expect.objectContaining({ code: 'too_large' }),
      );
    });
  });

  describe('times out', () => {
    it('throws timeout on slow response', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
        totalTimeoutMs: 200,
      };
      await expect(
        safeFetch(`http://public.test:${String(serverPort)}/slow`, {}, policy, { lookup }),
      ).rejects.toThrow(expect.objectContaining({ code: 'timeout' }));
    });
  });

  describe('enforces content types', () => {
    it('throws bad_content_type for application/octet-stream', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
        contentTypes: ['text/html', 'application/pdf'],
      };
      const res = await safeFetch(`http://public.test:${String(serverPort)}/exe`, {}, policy, {
        lookup,
      });
      expect(res.ok).toBe(true);
      await expect(res.arrayBuffer()).rejects.toThrow(
        expect.objectContaining({ code: 'bad_content_type' }),
      );
    });
  });

  describe('sends the policy user agent', () => {
    it('server echoes UA equals policy userAgent', async () => {
      const lookup = createLookupStub(new Map([['public.test', [`127.0.0.1`]]]));
      const customUA = 'CustomTestAgent/1.0';
      const policy = {
        ...crawlPolicyTest,
        allowPrivate: true,
        allowHosts: ['public.test'],
        allowedPorts: [serverPort],
        userAgent: customUA,
      };
      const res = await safeFetch(`http://public.test:${String(serverPort)}/ua`, {}, policy, {
        lookup,
      });
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe(customUA);
    });
  });

  describe('blocks hosts whose DNS returns any private address', () => {
    it('blocks when lookup returns both public and private', async () => {
      const lookup = createLookupStub(new Map([['mixed.test', ['8.8.8.8', '10.0.0.1']]]));
      const policy = { ...crawlPolicyTest, allowPrivate: false, allowHosts: ['mixed.test'] };
      await expect(safeFetch('http://mixed.test/', {}, policy, { lookup })).rejects.toThrow(
        expect.objectContaining({ code: 'blocked_address' }),
      );
    });
  });
});
