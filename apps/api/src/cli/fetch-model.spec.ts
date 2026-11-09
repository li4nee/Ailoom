// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Manifest } from '../providers/local/manifest';
import { type Downloader, fetchModels, parseArgs, run } from './fetch-model';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const REV = 'a'.repeat(40);

const manifest: Manifest = {
  models: [
    {
      id: 'bge-small-en-v1.5',
      repo: 'Xenova/bge-small-en-v1.5',
      revision: REV,
      dimensions: 384,
      license: 'MIT',
      pooling: 'cls',
      files: [
        { path: 'onnx/model_quantized.onnx', sha256: sha256('weights') },
        { path: 'config.json', sha256: sha256('{}') },
      ],
    },
    {
      id: 'multilingual-e5-small',
      repo: 'Xenova/multilingual-e5-small',
      revision: 'b'.repeat(40),
      dimensions: 384,
      license: 'MIT',
      pooling: 'mean',
      files: [{ path: 'config.json', sha256: sha256('{"e5":true}') }],
    },
  ],
};

const CONTENT: Record<string, string> = {
  [`https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${REV}/onnx/model_quantized.onnx`]:
    'weights',
  [`https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${REV}/config.json`]: '{}',
  [`https://huggingface.co/Xenova/multilingual-e5-small/resolve/${'b'.repeat(40)}/config.json`]:
    '{"e5":true}',
};

/** Serves `CONTENT` in two chunks per file and records every requested URL. */
function stubDownloader(override: Record<string, string> = {}): Downloader & { urls: string[] } {
  const urls: string[] = [];
  const download = (url: string): Promise<AsyncIterable<Uint8Array>> => {
    urls.push(url);
    const body = override[url] ?? CONTENT[url];
    if (body === undefined) return Promise.reject(new Error(`unexpected url ${url}`));
    const bytes = Buffer.from(body);
    const half = Math.floor(bytes.length / 2);
    return Promise.resolve(Readable.from([bytes.subarray(0, half), bytes.subarray(half)]));
  };
  return Object.assign(download, { urls });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ailoom-fetch-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fetchModels', () => {
  it('downloads every file of every model at its pinned revision', async () => {
    const download = stubDownloader();
    await fetchModels({ manifest, modelsDir: dir, download });
    expect(download.urls.sort()).toEqual(Object.keys(CONTENT).sort());
    expect(readFileSync(join(dir, 'bge-small-en-v1.5/onnx/model_quantized.onnx'), 'utf8')).toBe(
      'weights',
    );
    expect(readFileSync(join(dir, 'multilingual-e5-small/config.json'), 'utf8')).toBe(
      '{"e5":true}',
    );
  });

  it('rejects a checksum mismatch and deletes the file', async () => {
    const url = `https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${REV}/onnx/model_quantized.onnx`;
    const download = stubDownloader({ [url]: 'tampered' });
    await expect(fetchModels({ manifest, modelsDir: dir, download })).rejects.toThrow(
      /checksum mismatch for onnx\/model_quantized.onnx/,
    );
    expect(existsSync(join(dir, 'bge-small-en-v1.5/onnx/model_quantized.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'bge-small-en-v1.5/onnx/model_quantized.onnx.partial'))).toBe(
      false,
    );
  });

  it('replaces a corrupt local file and keeps a verified one', async () => {
    const corrupt = join(dir, 'bge-small-en-v1.5/onnx/model_quantized.onnx');
    mkdirSync(dirname(corrupt), { recursive: true });
    writeFileSync(corrupt, 'corrupt');
    writeFileSync(join(dir, 'bge-small-en-v1.5/config.json'), '{}');
    const download = stubDownloader();
    await fetchModels({ manifest, modelsDir: dir, download, only: 'bge-small-en-v1.5' });
    expect(download.urls).toEqual([
      `https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${REV}/onnx/model_quantized.onnx`,
    ]);
    expect(readFileSync(corrupt, 'utf8')).toBe('weights');
  });

  it('deletes a corrupt local file when the new download does not verify either', async () => {
    const corrupt = join(dir, 'multilingual-e5-small/config.json');
    mkdirSync(dirname(corrupt), { recursive: true });
    writeFileSync(corrupt, 'corrupt');
    const url = `https://huggingface.co/Xenova/multilingual-e5-small/resolve/${'b'.repeat(40)}/config.json`;
    await expect(
      fetchModels({
        manifest,
        modelsDir: dir,
        download: stubDownloader({ [url]: 'bad' }),
        only: 'multilingual-e5-small',
      }),
    ).rejects.toThrow(/checksum mismatch for config.json/);
    expect(existsSync(corrupt)).toBe(false);
  });

  it('rejects an unknown --only model', async () => {
    await expect(
      fetchModels({ manifest, modelsDir: dir, download: stubDownloader(), only: 'nope' }),
    ).rejects.toThrow(/unknown model nope/);
  });
});

describe('fetch-model command', () => {
  it('parses --only', () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(['--only', 'multilingual-e5-small'])).toEqual({
      only: 'multilingual-e5-small',
    });
    expect(() => parseArgs(['--only'])).toThrow(/--only needs a model id/);
    expect(() => parseArgs(['--force'])).toThrow(/unknown argument --force/);
  });

  it('exits 1 with the reason on a checksum mismatch', async () => {
    const url = `https://huggingface.co/Xenova/multilingual-e5-small/resolve/${'b'.repeat(40)}/config.json`;
    const errors: string[] = [];
    const code = await run(['--only', 'multilingual-e5-small'], {
      manifest,
      modelsDir: dir,
      download: stubDownloader({ [url]: 'bad' }),
      log: () => undefined,
      error: (line) => errors.push(line),
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toMatch(/checksum mismatch for config.json/);
  });

  it('exits 0 when every file verifies', async () => {
    const code = await run([], {
      manifest,
      modelsDir: dir,
      download: stubDownloader(),
      log: () => undefined,
      error: () => undefined,
    });
    expect(code).toBe(0);
  });
});
