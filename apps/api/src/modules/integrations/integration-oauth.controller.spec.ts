// SPDX-License-Identifier: AGPL-3.0-only
import type { NodeResponse } from '@nestjs/platform-node';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../common/config';
import { IntegrationOAuthCallbackController } from './integration-oauth.controller';
import type { IntegrationsService } from './integrations.service';
import type { OAuthFlowService } from './oauth-flow.service';

const STATE = 's'.repeat(43);

function setup() {
  const oauth = {
    complete: vi.fn().mockRejectedValue(new Error('not reached in these tests')),
    cancel: vi.fn().mockResolvedValue(null),
  };
  const integrations = { connect: vi.fn() };
  const config = { publicUrl: new URL('https://support.example.com') } as unknown as AppConfig;
  const controller = new IntegrationOAuthCallbackController(
    oauth as unknown as OAuthFlowService,
    integrations as unknown as IntegrationsService,
    config,
  );
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: vi.fn(),
  } as unknown as NodeResponse;
  return { controller, oauth, integrations, response, headers };
}

describe('IntegrationOAuthCallbackController', () => {
  it('rejects a repeated code parameter without exchanging it', async () => {
    const { controller, oauth, integrations, response, headers } = setup();

    await controller.callback(
      'hubspot',
      STATE,
      ['code-a', 'code-b'],
      undefined,
      undefined,
      response,
    );

    expect(oauth.complete).not.toHaveBeenCalled();
    expect(integrations.connect).not.toHaveBeenCalled();
    expect(headers['location']).toBe('https://support.example.com/?crm_oauth=failed');
  });

  it('rejects a repeated state parameter without exchanging the code', async () => {
    const { controller, oauth, response, headers } = setup();

    await controller.callback('hubspot', [STATE, STATE], 'code-a', undefined, undefined, response);

    expect(oauth.complete).not.toHaveBeenCalled();
    expect(headers['location']).toBe('https://support.example.com/?crm_oauth=failed');
  });

  it('drops a repeated accounts-server parameter instead of forwarding it', async () => {
    const { controller, oauth, response } = setup();

    await controller.callback(
      'zoho',
      STATE,
      'code-a',
      undefined,
      ['https://a', 'https://b'],
      response,
    );

    expect(oauth.complete).toHaveBeenCalledWith('zoho', STATE, 'code-a', new URLSearchParams());
  });

  it('treats a repeated error parameter as a cancelled authorization', async () => {
    const { controller, oauth, response, headers } = setup();

    await controller.callback(
      'hubspot',
      STATE,
      undefined,
      ['denied', 'denied'],
      undefined,
      response,
    );

    expect(oauth.cancel).toHaveBeenCalledWith('hubspot', STATE);
    expect(oauth.complete).not.toHaveBeenCalled();
    expect(headers['location']).toBe('https://support.example.com/?crm_oauth=cancelled');
  });
});
