// SPDX-License-Identifier: AGPL-3.0-only
import type { AppConfig } from '../config/config.schema';

export type LookupFn = (host: string) => Promise<{ address: string; family: 4 | 6 }[]>;

export interface FetchPolicy {
  name: 'crawl' | 'provider' | 'webhook';
  allowPrivate: boolean;
  allowHosts: string[];
  denyHosts: string[];
  allowedPorts: number[] | 'any';
  maxBytes: number;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
  maxRedirects: number;
  contentTypes: string[] | null;
  userAgent: string;
}

const COMPOSE_DENYLIST = [
  'postgres',
  'api',
  'worker',
  'web',
  'caddy',
  'migrate',
  'metadata.google.internal',
];

export function crawlPolicy(config: AppConfig): FetchPolicy {
  return {
    name: 'crawl',
    allowPrivate: false,
    allowHosts: [],
    denyHosts: [],
    allowedPorts: [80, 443],
    maxBytes: 5 * 1024 * 1024,
    connectTimeoutMs: 10_000,
    totalTimeoutMs: 30_000,
    maxRedirects: 5,
    contentTypes: [
      'text/html',
      'application/xhtml+xml',
      'application/xml',
      'text/xml',
      'text/plain',
      'application/pdf',
    ],
    userAgent: config.crawl.userAgent !== '' ? config.crawl.userAgent : 'AiLoomCrawler/1.0',
  };
}

export function providerPolicy(config: AppConfig): FetchPolicy {
  const allowPrivate = config.providerUrls.allowPrivate;
  const denylist = [...COMPOSE_DENYLIST, ...config.providerUrls.denylist];
  return {
    name: 'provider',
    allowPrivate,
    allowHosts: config.providerUrls.allowlist,
    denyHosts: denylist,
    allowedPorts: 'any',
    maxBytes: 50 * 1024 * 1024,
    connectTimeoutMs: 10_000,
    totalTimeoutMs: 120_000,
    maxRedirects: 0,
    contentTypes: null,
    userAgent: config.crawl.userAgent !== '' ? config.crawl.userAgent : 'AiLoomProvider/1.0',
  };
}

export function webhookPolicy(config: AppConfig): FetchPolicy {
  return {
    name: 'webhook',
    allowPrivate: false,
    allowHosts: [],
    denyHosts: [...COMPOSE_DENYLIST],
    allowedPorts: [80, 443],
    maxBytes: 256 * 1024,
    connectTimeoutMs: 5_000,
    totalTimeoutMs: 10_000,
    maxRedirects: 0,
    contentTypes: null,
    userAgent: config.crawl.userAgent !== '' ? config.crawl.userAgent : 'AiLoomWebhook/1.0',
  };
}
