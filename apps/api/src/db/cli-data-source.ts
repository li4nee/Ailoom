// SPDX-License-Identifier: AGPL-3.0-only
// Data source for the TypeORM CLI (`pnpm db:migrate`, `db:revert`, `db:generate`, `db:check`):
//   typeorm -d src/db/cli-data-source.ts ...
// The application itself builds its data source from the already validated config instead.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { DataSource } from 'typeorm';

import { loadConfig } from '../common/config/load-config';
import { buildDataSourceOptions } from './data-source';

// pnpm runs package scripts in apps/api; a developer's .env sits at the repository root.
// Variables that are already set win over the file, so CI and containers need no .env.
const envFile = resolve(__dirname, '../../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default new DataSource(buildDataSourceOptions(loadConfig(process.env).database));
