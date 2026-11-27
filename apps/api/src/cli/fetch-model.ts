// SPDX-License-Identifier: AGPL-3.0-only
// Downloads the built-in embedding and retrieval-reranking models in models/manifest.json,
// from Hugging Face,
// at each model's pinned revision, and verifies every file's SHA-256:
//   pnpm --filter @app/api fetch-model [--only <model id>]
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DEFAULT_MODELS_DIR } from '../providers/local/catalog';
import {
  type Manifest,
  type ManifestModel,
  type ManifestReranker,
  readManifest,
} from '../providers/local/manifest';

/** Fetches `url` and yields the response body. */
export type Downloader = (url: string) => Promise<AsyncIterable<Uint8Array>>;

/** The real downloader. The host is fixed (huggingface.co), never user-supplied. */
const httpDownload: Downloader = async (url) => {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: ${String(response.status)} ${url}`);
  }
  return response.body;
};

function fileUrl(model: ManifestModel | ManifestReranker, path: string): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${path}`;
}

/** SHA-256 of a local file, or null when it does not exist. */
async function fileSha256(path: string): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return hash.digest('hex');
}

export interface FetchModelsOptions {
  manifest: Manifest;
  modelsDir: string;
  download: Downloader;
  /** Only this model id. */
  only?: string;
  log?: (line: string) => void;
}

/**
 * Brings `<modelsDir>/<id>/` up to date for every listed model. A file already present with
 * the right checksum is kept. Downloads go to `<file>.partial` and are renamed only once the
 * checksum matches; on a mismatch the file is deleted and this rejects.
 */
export async function fetchModels(opts: FetchModelsOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);
  const models = [...opts.manifest.models, ...opts.manifest.rerankers];
  const selected = opts.only === undefined ? models : models.filter((m) => m.id === opts.only);
  if (opts.only !== undefined && selected.length === 0) {
    throw new Error(`unknown model ${opts.only}`);
  }
  for (const model of selected) {
    for (const file of model.files) {
      const target = join(opts.modelsDir, model.id, file.path);
      if ((await fileSha256(target)) === file.sha256) {
        log(`${model.id}: ${file.path} ok`);
        continue;
      }
      log(`${model.id}: downloading ${file.path}`);
      const partial = `${target}.partial`;
      await mkdir(dirname(target), { recursive: true });
      const hash = createHash('sha256');
      try {
        const body = await opts.download(fileUrl(model, file.path));
        await writeFile(
          partial,
          (async function* hashed() {
            for await (const chunk of body) {
              hash.update(chunk);
              yield chunk;
            }
          })(),
        );
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
      if (hash.digest('hex') !== file.sha256) {
        // Neither the bad download nor an older corrupt copy may stay behind.
        await Promise.all([rm(partial, { force: true }), rm(target, { force: true })]);
        throw new Error(`checksum mismatch for ${file.path} (${model.id})`);
      }
      await rename(partial, target);
    }
    log(`${model.id}: ready`);
  }
}

export function parseArgs(argv: readonly string[]): { only?: string } {
  const args: { only?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') {
      const id = argv[i + 1];
      if (id === undefined || id.startsWith('--')) throw new Error('--only needs a model id');
      args.only = id;
      i += 1;
    } else {
      throw new Error(`unknown argument ${String(arg)}`);
    }
  }
  return args;
}

export interface RunDeps {
  manifest: Manifest;
  modelsDir: string;
  download: Downloader;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The command: returns the process exit code. */
export async function run(argv: readonly string[], deps: RunDeps): Promise<number> {
  try {
    await fetchModels({ ...deps, ...parseArgs(argv) });
    return 0;
  } catch (error) {
    deps.error(`fetch-model: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// Runs when started as `node src/cli/fetch-model.ts`, not when imported (tests).
if (typeof require !== 'undefined' && require.main === module) {
  void run(process.argv.slice(2), {
    manifest: readManifest(join(DEFAULT_MODELS_DIR, 'manifest.json')),
    modelsDir: DEFAULT_MODELS_DIR,
    download: httpDownload,
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  }).then((code) => {
    process.exitCode = code;
  });
}
