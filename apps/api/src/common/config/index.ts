// SPDX-License-Identifier: AGPL-3.0-only
export { CONFIG_ENV_KEYS, type AppConfig, type ConfigEnvKey } from './config.schema';
export { APP_CONFIG, ConfigModule } from './config.module';
export { ConfigError, loadConfig, type ConfigIssue } from './load-config';
