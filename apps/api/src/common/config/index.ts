// SPDX-License-Identifier: AGPL-3.0-only
export {
  CONFIG_ENV_KEYS,
  LOCAL_EMBEDDING_MODEL_IDS,
  type AppConfig,
  type ConfigEnvKey,
  type LocalEmbeddingModelId,
} from './config.schema';
export { APP_CONFIG, ConfigModule } from './config.module';
export { ConfigError, loadConfig, type ConfigIssue } from './load-config';
