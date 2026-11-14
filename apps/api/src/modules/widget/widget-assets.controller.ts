// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';

import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';

import { Public } from '../../modules/auth';

/** The directory holding the built widget (`widget.js` and `<version>/…`). */
export const WIDGET_ASSETS_DIR = Symbol('WIDGET_ASSETS_DIR');

const LOADER_CACHE = 'public, max-age=300';
/** A versioned URL never changes, so the browser can keep it for a year. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

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

/**
 * `GET /widget.js` and `GET /widget/:version/*file` (spec §16.3): the embeddable loader and the
 * versioned bundles it imports. These are not under `/api`, so the route is excluded from the
 * global prefix in `create-http-app`. Both are public and send no cookies: CORP allows a browser
 * on any customer site to load them.
 */
@Public()
@Controller()
export class WidgetAssetsController {
  private readonly assets: WidgetAssets;

  constructor(@Inject(WIDGET_ASSETS_DIR) directory: string) {
    this.assets = new WidgetAssets(directory);
  }

  @Get('widget.js')
  loader(@Res() response: NodeResponse): void {
    this.send(response, 'widget.js', LOADER_CACHE);
  }

  @Get('widget/:version/*file')
  file(
    @Param('version') version: string,
    @Param('file') file: string | string[],
    @Res() response: NodeResponse,
  ): void {
    const path = Array.isArray(file) ? file.join('/') : file;
    this.send(response, `${version}/${path}`, IMMUTABLE_CACHE);
  }

  private send(response: NodeResponse, path: string, cacheControl: string): void {
    const asset = this.assets.get(path);
    if (asset === undefined) throw new NotFoundException();

    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('Cache-Control', cacheControl);
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(asset.body);
  }
}
