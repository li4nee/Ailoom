// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { enqueueReencrypt } from './credentials-reencrypt';

describe('credentials-reencrypt cli', () => {
  it('enqueues the job and prints its id', async () => {
    const enqueue = vi.fn(() => Promise.resolve('job-42'));
    const write: string[] = [];

    const code = await enqueueReencrypt({
      jobs: { enqueue },
      write: (line) => write.push(line),
    });

    expect(code).toBe(0);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(write).toEqual(['enqueued job-42']);
  });

  it('says so when the job is already queued', async () => {
    const write: string[] = [];

    const code = await enqueueReencrypt({
      jobs: { enqueue: () => Promise.resolve(null) },
      write: (line) => write.push(line),
    });

    expect(code).toBe(0);
    expect(write).toEqual(['already queued']);
  });

  it('reports a failure and exits non-zero', async () => {
    const write: string[] = [];

    const code = await enqueueReencrypt({
      jobs: {
        enqueue: () => Promise.reject(new Error('database is down')),
      },
      write: (line) => write.push(line),
    });

    expect(code).toBe(1);
    expect(write[0]).toContain('database is down');
  });
});
