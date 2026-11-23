// SPDX-License-Identifier: AGPL-3.0-only
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { strings } from '@/strings';
import { mockApi } from '@/test/fetch';
import { renderWithQuery } from '@/test/render';
import type {
  IntegrationDeliveryDto,
  IntegrationDto,
  WebhookDeliveryDto,
  WebhookDto,
} from '@app/shared';

import { IntegrationsSettings } from './components/integrations-settings';

const WS = 'w1';
const INTEGRATION: IntegrationDto = {
  id: 'integration-1',
  workspaceId: WS,
  provider: 'hubspot',
  name: 'Support CRM',
  status: 'reauth_required',
  scopes: ['contacts', 'tickets'],
  externalAccountId: 'portal-1',
  transcriptSharing: false,
  lastError: 'reauth_required',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  disconnectedAt: null,
};
const WEBHOOK: WebhookDto = {
  id: 'webhook-1',
  workspaceId: WS,
  url: 'https://example.com/events',
  events: ['handoff.requested'],
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastError: null,
};
const DELIVERY: WebhookDeliveryDto = {
  id: 'delivery-1',
  workspaceId: WS,
  webhookId: WEBHOOK.id,
  eventId: 'event-1',
  eventType: 'handoff.requested',
  status: 'failed',
  statusCode: 503,
  durationMs: 1000,
  attemptCount: 6,
  lastError: 'delivery_retryable',
  nextAttemptAt: null,
  deliveredAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};
const CRM_DELIVERY: IntegrationDeliveryDto = {
  id: 'crm-delivery-1',
  workspaceId: WS,
  integrationId: INTEGRATION.id,
  eventId: 'event-crm-1',
  eventType: 'contact.updated',
  status: 'delivered',
  attemptCount: 1,
  statusCode: 200,
  durationMs: 42,
  lastError: null,
  externalObjectType: 'contact',
  externalObjectId: 'crm-contact-1',
  deliveredAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('IntegrationsSettings', () => {
  it('shows provider setup steps and updates them when the provider changes', async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}/integrations`]: [200, []],
      [`GET /api/v1/workspaces/${WS}/webhooks`]: [200, []],
    });

    renderWithQuery(<IntegrationsSettings workspaceId={WS} />);

    expect(await screen.findByText(/crm\.objects\.contacts\.read/u)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: strings.integrations.setupDocs })).toHaveAttribute(
      'href',
      strings.integrations.setupGuides.hubspot.url,
    );

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: strings.integrations.provider }),
      'zendesk',
    );
    expect(await screen.findByText(/Zendesk Support test instance/u)).toBeInTheDocument();
  });

  it('shows reauthentication and transcript privacy state, and replays failed deliveries', async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}/integrations`]: [200, [INTEGRATION]],
      [`GET /api/v1/workspaces/${WS}/integrations/${INTEGRATION.id}/deliveries`]: [
        200,
        [CRM_DELIVERY],
      ],
      [`GET /api/v1/workspaces/${WS}/webhooks`]: [200, [WEBHOOK]],
      [`GET /api/v1/workspaces/${WS}/webhooks/${WEBHOOK.id}/deliveries`]: [200, [DELIVERY]],
      [`POST /api/v1/workspaces/${WS}/webhooks/${WEBHOOK.id}/deliveries/${DELIVERY.id}/replay`]: [
        204,
      ],
    });

    renderWithQuery(<IntegrationsSettings workspaceId={WS} />);

    expect(
      await screen.findByText(strings.integrations.statuses.reauth_required),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /transcript/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/crm-contact-1/)).toBeInTheDocument();
    expect(screen.getAllByText('contact.updated')).toHaveLength(2);
    expect(await screen.findByText(WEBHOOK.url)).toBeInTheDocument();
    expect(await screen.findByText(/Failed · 6 attempts/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: strings.webhooks.replay }));

    expect(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.url ===
            `/api/v1/workspaces/${WS}/webhooks/${WEBHOOK.id}/deliveries/${DELIVERY.id}/replay`,
      ),
    ).toBe(true);
  });
});
