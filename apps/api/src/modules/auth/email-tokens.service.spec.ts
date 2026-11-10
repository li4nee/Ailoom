// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../common/clock';
import { sha256Hex } from '../../common/crypto';
import type { EmailTokenRow, EmailTokenStore } from './email-tokens.repository';
import { EmailTokensService } from './email-tokens.service';

const USER_ID = '0190a000-0000-7000-8000-000000000001';

describe('EmailTokensService', () => {
  it('issues a hashed single-use token', async () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    const rows: EmailTokenRow[] = [];
    const store: EmailTokenStore = {
      create: (row: EmailTokenRow) => {
        rows.push(row);
        return Promise.resolve();
      },
    };
    const service = new EmailTokensService(store, clock);

    const token = await service.issue(USER_ID, 'verify_email', 24);

    const [row] = rows;
    expect(row).toBeDefined();
    expect(row!.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.expiresAt).toEqual(new Date('2026-01-02T00:00:00Z'));
    expect(row!.type).toBe('verify_email');
    expect(row!.userId).toBe(USER_ID);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });
});
