// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const BASE_URL = 'http://localhost:18080';
export const MAILPIT_URL = 'http://127.0.0.1:18025';

/** The compose command for the throwaway e2e project; never touches a real stack. */
export function compose(...args: string[]): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'ailoom-e2e',
      '-f',
      'deploy/docker-compose.yml',
      '-f',
      'deploy/docker-compose.e2e.yml',
      '--env-file',
      '.env.e2e',
      ...args,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
