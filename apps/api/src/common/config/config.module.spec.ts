// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { APP_CONFIG, ConfigModule } from './config.module';
import { loadConfig } from './load-config';

describe('ConfigModule', () => {
  it('provides the validated config globally under APP_CONFIG', () => {
    const config = loadConfig({
      PUBLIC_URL: 'http://localhost:8080',
      DATABASE_URL: 'postgres://u:p@localhost/db',
      AUTH_SECRET: 'a'.repeat(32),
      WIDGET_SECRET: 'b'.repeat(32),
      ENCRYPTION_KEYS: `v1:${'0'.repeat(64)}`,
    });
    const dynamic = ConfigModule.forRoot(config);
    expect(dynamic.global).toBe(true);
    expect(dynamic.providers).toEqual([{ provide: APP_CONFIG, useValue: config }]);
    expect(dynamic.exports).toEqual([APP_CONFIG]);
  });
});
