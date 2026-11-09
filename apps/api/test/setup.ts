// SPDX-License-Identifier: AGPL-3.0-only
// Runs before every integration and e2e test file: no test may reach the real network.
// Anything but localhost is refused; tests that fetch intercept the request through
// `getGlobalDispatcher()` (undici's MockAgent API).
import { MockAgent, setGlobalDispatcher } from 'undici';
import { afterAll } from 'vitest';

const agent = new MockAgent();
agent.disableNetConnect();
agent.enableNetConnect(/^(localhost|127\.0\.0\.1)(:\d+)?$/);
setGlobalDispatcher(agent);

afterAll(async () => {
  await agent.close();
});
