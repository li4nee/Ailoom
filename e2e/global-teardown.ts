// SPDX-License-Identifier: AGPL-3.0-only
import { compose } from './stack';

export default function globalTeardown(): void {
  if (process.env['E2E_REUSE_STACK'] === '1') return;
  compose('down', '-v', '--remove-orphans');
}
