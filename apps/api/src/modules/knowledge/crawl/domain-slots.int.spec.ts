// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getTestDataSource } from '../../../../test/helpers/db';
import { DomainSlots } from './domain-slots';

let slots: DomainSlots;
const releases: (() => void)[] = [];

function hold(): Promise<string> {
  return new Promise((resolve) => {
    releases.push(() => {
      resolve('done');
    });
  });
}

beforeAll(async () => {
  slots = new DomainSlots(await getTestDataSource());
});

afterAll(() => {
  for (const release of releases) release();
});

describe('DomainSlots', () => {
  it('allows two pages per domain and reports the third as busy', async () => {
    const first = slots.withSlot('crawl-test.example', hold);
    const second = slots.withSlot('crawl-test.example', hold);
    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(
      slots.withSlot('crawl-test.example', () => Promise.resolve('third')),
    ).resolves.toBe('busy');

    // Another domain is independent.
    const other = slots.withSlot('other.example', () => Promise.resolve('other'));
    await expect(other).resolves.toBe('other');

    for (const release of releases.splice(0)) release();
    await expect(first).resolves.toBe('done');
    await expect(second).resolves.toBe('done');

    await expect(
      slots.withSlot('crawl-test.example', () => Promise.resolve('after')),
    ).resolves.toBe('after');
  });
});
