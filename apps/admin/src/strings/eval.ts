// SPDX-License-Identifier: AGPL-3.0-only
export const evalStrings = {
  toolFixtures: 'Mock tool fixtures (JSON)',
  toolFixturesHelp:
    'Optional. Each fixture pins the tool name, exact arguments and projected result. Evaluation never calls the live endpoint. Example: [{"toolName":"lookup_stock","arguments":{"sku":"A-1"},"result":{"available":true}}]',
  invalidToolFixtures: 'Tool fixtures must be valid JSON.',
  caseToolFixtures: (count: number) => `${String(count)} tool fixture${count === 1 ? '' : 's'}`,
} as const;
