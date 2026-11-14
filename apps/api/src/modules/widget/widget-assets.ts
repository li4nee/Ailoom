// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';

import type { ConnectMiddleware } from './widget-cors';

const LOADER_CACHE = 'public, max-age=300';
/** A versioned URL never changes, so the browser can keep it for a year. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const LOADER_PATH = /^\/widget\.js$/;
/** `/widget/<version>/<file>`, where `<file>` may contain slashes (`i18n/en.json`). */
const VERSIONED_PATH = /^\/widget\/([^/]+)\/(.+)$/;

interface Asset {
  body: Buffer;
  contentType: string;
}

/**
 * Walks the widget dist directory once at boot into an allowlist keyed by request path
 * (`widget.js` for the loader, `<version>/<file>` for everything else). Serving only keys from
 * this map is what makes path traversal impossible: `..` is never a key.
 */
class WidgetAssets {
  private readonly assets: Map<string, Asset>;

  constructor(directory: string) {
    this.assets = this.read(directory);
  }

  get(path: string): Asset | undefined {
    return this.assets.get(path);
  }

  private read(directory: string): Map<string, Asset> {
    const assets = new Map<string, Asset>();
    const loader = join(directory, 'widget.js');
    if (!existsSync(loader)) return assets;

    assets.set('widget.js', this.asset(loader));

    for (const version of readdirSync(directory, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      const versionDir = join(directory, version.name);
      for (const file of this.walk(versionDir)) {
        const key = `${version.name}/${relative(versionDir, file).split(sep).join('/')}`;
        assets.set(key, this.asset(file));
      }
    }
    return assets;
  }

  private walk(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...this.walk(path));
      else if (entry.isFile() && lstatSync(path).isFile()) files.push(path);
    }
    return files;
  }

  private asset(path: string): Asset {
    return {
      body: readFileSync(path),
      contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
    };
  }
}

/**
 * Where the built widget lives. The container copies `packages/widget/dist` to
 * `/app/widget-dist`; a repository checkout has it under `packages/widget/dist`. Walk up from
 * this file so neither a source run nor a compiled run depends on the working directory.
 */
export function defaultWidgetAssetsDir(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    for (const candidate of [
      join(directory, 'packages/widget/dist'),
      join(directory, 'widget-dist'),
    ]) {
      if (existsSync(join(candidate, 'widget.js'))) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return join(__dirname, '../../../widget-dist');
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/**
 * `GET /widget.js` and `GET /widget/:version/*file` (spec §16.3): the embeddable loader and the
 * versioned bundles it imports. A connect middleware rather than a controller because these
 * live outside `/api`, and a controller exclusion from the global prefix would also match the
 * widget API routes (`/widget/v1/…`). Both responses send no cookies and allow any origin to
 * load them through CORP.
 */
export function widgetAssets(directory: string): ConnectMiddleware {
  const assets = new WidgetAssets(directory);

  return (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    const pathname = pathnameOf(request.url ?? '');
    if (pathname === null) {
      next();
      return;
    }

    let key: string;
    let cacheControl: string;
    if (LOADER_PATH.test(pathname)) {
      key = 'widget.js';
      cacheControl = LOADER_CACHE;
    } else {
      const match = VERSIONED_PATH.exec(pathname);
      if (match?.[1] === undefined || match[2] === undefined) {
        next();
        return;
      }
      let version: string;
      let file: string;
      try {
        version = decodeURIComponent(match[1]);
        file = decodeURIComponent(match[2]);
      } catch {
        next();
        return;
      }
      key = `${version}/${file}`;
      cacheControl = IMMUTABLE_CACHE;
    }

    const asset = assets.get(key);
    if (asset === undefined) {
      next();
      return;
    }

    response.statusCode = 200;
    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Cache-Control', cacheControl);
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') response.end();
    else response.end(asset.body);
  };
}
