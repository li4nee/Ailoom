// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createHttpApp } from './app/create-http-app';
import { ConfigError, loadConfig } from './common/config';

// A developer's `.env` sits at the repository root. Variables already set win over the file,
// so containers and CI need no such file.
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const app = await createHttpApp(config);
  // Close the HTTP server, pg-boss and the DB pool cleanly on `docker stop` / redeploys.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  await app.listen(3000, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
