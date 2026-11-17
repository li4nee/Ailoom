// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import type { IntegrationProvider } from '@app/shared';

import type { IntegrationConnector } from './connector';

/** Provider-neutral registry. Provider adapters register here without leaking into core services. */
@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<IntegrationProvider, IntegrationConnector>();

  constructor(connectors: readonly IntegrationConnector[] = []) {
    for (const connector of connectors) this.register(connector);
  }

  register(connector: IntegrationConnector): void {
    if (this.connectors.has(connector.provider)) {
      throw new Error(`Integration connector already registered: ${connector.provider}`);
    }
    this.connectors.set(connector.provider, connector);
  }

  get(provider: IntegrationProvider): IntegrationConnector | null {
    return this.connectors.get(provider) ?? null;
  }

  list(): readonly IntegrationConnector[] {
    return [...this.connectors.values()];
  }
}
