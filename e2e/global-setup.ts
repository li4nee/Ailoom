// SPDX-License-Identifier: AGPL-3.0-only
import { compose } from './stack';

/**
 * Starts the whole production stack (Caddy, api, worker, Postgres) plus Mailpit, from a clean
 * slate. `E2E_NO_BUILD=1` reuses images built earlier (CI); `E2E_REUSE_STACK=1` skips both
 * start and teardown for fast local iteration against a stack you started yourself.
 */
export default function globalSetup(): void {
  if (process.env['E2E_REUSE_STACK'] === '1') return;
  compose('down', '-v', '--remove-orphans');
  compose('up', '-d', '--wait', ...(process.env['E2E_NO_BUILD'] === '1' ? [] : ['--build']));
}
