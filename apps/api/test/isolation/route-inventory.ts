// SPDX-License-Identifier: AGPL-3.0-only
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';

import { API_PREFIX } from '../../src/app/create-http-app';

export interface Route {
  method: string;
  path: string;
}

function paths(metadata: unknown): string[] {
  if (typeof metadata === 'string') return [metadata];
  if (Array.isArray(metadata)) return metadata.filter((p): p is string => typeof p === 'string');
  return [''];
}

function join(...segments: string[]): string {
  const parts = segments.flatMap((s) => s.split('/')).filter((s) => s.length > 0);
  return `/${parts.join('/')}`;
}

/**
 * Every HTTP route the app registered, as `{ method, path }` with the `/api` prefix and
 * `:param` names, e.g. `{ method: 'GET', path: '/api/v1/workspaces/:workspaceId/bots' }`.
 *
 * Read from the controller metadata Nest routes from, so it does not depend on the HTTP
 * adapter's internals.
 */
export function listRoutes(app: INestApplication): Route[] {
  const routes = new Map<string, Route>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (typeof metatype !== 'function') continue;
      const prototype: unknown = metatype.prototype;
      if (typeof prototype !== 'object' || prototype === null) continue;
      const controllerPaths = paths(Reflect.getMetadata(PATH_METADATA, metatype));
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler: unknown = Reflect.get(prototype, name);
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const methodId: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        const method = typeof methodId === 'number' ? RequestMethod[methodId] : undefined;
        if (method === undefined) continue;
        for (const controllerPath of controllerPaths) {
          for (const handlerPath of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
            const route = {
              method,
              path: join(API_PREFIX, controllerPath, handlerPath),
            };
            routes.set(`${route.method} ${route.path}`, route);
          }
        }
      }
    }
  }
  return [...routes.values()];
}
