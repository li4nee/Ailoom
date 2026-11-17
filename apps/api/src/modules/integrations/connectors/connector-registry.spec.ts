// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { IntegrationConnector } from './connector';
import { ConnectorRegistry } from './connector-registry';

const connector = { provider: 'hubspot', capabilities: [] } as unknown as IntegrationConnector;

describe('ConnectorRegistry', () => {
  it('registers and resolves one provider connector', () => {
    const registry = new ConnectorRegistry([connector]);

    expect(registry.get('hubspot')).toBe(connector);
    expect(registry.list()).toEqual([connector]);
  });

  it('rejects duplicate provider registrations', () => {
    const registry = new ConnectorRegistry([connector]);

    expect(() => {
      registry.register(connector);
    }).toThrow('already registered');
  });
});
