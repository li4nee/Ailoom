// SPDX-License-Identifier: AGPL-3.0-only
// Seeds the demo workspace used by local development, screenshots and the Docker demo:
//   pnpm --filter @app/api db:seed [--force-demo]
import { loadConfig } from '../common/config/load-config';
import dataSource from '../db/cli-data-source';
import { loadSeedDocuments } from '../db/seed/fixtures';
import { seedDemo } from '../db/seed/seed';
import { chunkMarkdown } from '../modules/knowledge/domain/chunker';
import { DEFAULT_MODELS_DIR, localModelStatus } from '../providers/local/catalog';
import { createLocalEmbeddingModel } from '../providers/local/local-embedding-model';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (process.env['NODE_ENV'] === 'production' && !args.includes('--force-demo')) {
    throw new Error('Refusing to seed demo data in production without --force-demo.');
  }

  const config = loadConfig(process.env);
  const modelId = config.localEmbeddingModel;
  if (localModelStatus(DEFAULT_MODELS_DIR, modelId) !== 'ready') {
    throw new Error(
      `The ${modelId} model is missing: run pnpm --filter @app/api fetch-model first.`,
    );
  }
  const model = createLocalEmbeddingModel({ modelsDir: DEFAULT_MODELS_DIR, id: modelId });

  await dataSource.initialize();
  try {
    const summary = await seedDemo({
      dataSource,
      documents: loadSeedDocuments(),
      chunk: (document) => chunkMarkdown(document),
      seedOllama: process.env['SEED_OLLAMA'] === '1',
      embed: async (texts, purpose) => {
        const vectors: number[][] = [];
        for (const text of texts) {
          const result = await model.doEmbed({
            values: [text],
            providerOptions: { local: { purpose } },
          });
          const vector = result.embeddings[0];
          if (vector === undefined) throw new Error('The embedding model returned no vector.');
          vectors.push(vector);
        }
        return vectors;
      },
    });
    process.stdout.write(
      `Seeded ${DEMO_EMAIL_LABEL} / devpassword: ${String(summary.conversations)} conversations, ` +
        `${String(summary.traces)} traces, ${String(summary.usageDays)} usage days.\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

const DEMO_EMAIL_LABEL = 'dev@example.com';

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
