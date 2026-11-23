// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { NodeResponse } from '@nestjs/platform-node';
import { z } from 'zod';

import { integrationProviderSchema } from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { AppError } from '../../common/errors';
import { asUserId, asWorkspaceId } from '../../db/ids';
import { CurrentPrincipal, Public, RequireApiKeyScope, RequireRole, type Principal } from '../auth';
import { IntegrationsService } from './integrations.service';
import { OAuthFlowService } from './oauth-flow.service';

const startSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: z.url({ protocol: /^https$/ }).optional(),
  scopes: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  returnUrl: z.url({ protocol: /^https?$/ }),
});

@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/integrations')
export class IntegrationOAuthStartController {
  constructor(private readonly oauth: OAuthFlowService) {}

  @Post(':provider/oauth/start')
  @RequireApiKeyScope('integrations:manage')
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('provider') rawProvider: string,
    @Body() body: unknown,
  ): Promise<{ authorizationUrl: string }> {
    const provider = integrationProviderSchema.safeParse(rawProvider);
    const input = startSchema.safeParse(body);
    if (!provider.success || !input.success) throw new AppError('validation_failed');
    return this.oauth.start({
      workspaceId,
      actorUserId: principal.userId,
      provider: provider.data,
      name: input.data.name,
      scopes: input.data.scopes,
      returnUrl: input.data.returnUrl,
      ...(input.data.baseUrl === undefined ? {} : { baseUrl: input.data.baseUrl }),
    });
  }
}

@Controller('v1/integrations/oauth')
export class IntegrationOAuthCallbackController {
  constructor(
    private readonly oauth: OAuthFlowService,
    private readonly integrations: IntegrationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('callback/:provider')
  async callback(
    @Param('provider') rawProvider: string,
    @Query('state') state: string | undefined,
    @Query('code') code: string | undefined,
    @Query('error') providerError: string | undefined,
    @Query('accounts-server') accountsServer: string | undefined,
    @Res() response: NodeResponse,
  ): Promise<void> {
    const parsedProvider = integrationProviderSchema.safeParse(rawProvider);
    if (!parsedProvider.success) {
      this.redirect(response, new URL('/?crm_oauth=failed', this.config.publicUrl).toString());
      return;
    }
    const provider = parsedProvider.data;
    const safeState = typeof state === 'string' ? state : '';
    if (providerError !== undefined) {
      const returnUrl = await this.oauth.cancel(provider, safeState);
      this.redirect(response, addResult(returnUrl, 'cancelled', this.config));
      return;
    }
    if (code === undefined) {
      this.redirect(response, addResult(null, 'failed', this.config));
      return;
    }
    try {
      const completion = await this.oauth.complete(
        provider,
        safeState,
        code,
        new URLSearchParams(
          accountsServer === undefined ? {} : { 'accounts-server': accountsServer },
        ),
      );
      await this.integrations.connect(
        asWorkspaceId(completion.workspaceId),
        asUserId(completion.actorUserId),
        {
          provider: completion.provider,
          name: completion.name,
          scopes: completion.scopes,
          accessToken: completion.credentials.accessToken,
          authMode: 'bearer',
          ...(completion.credentials.refreshToken === undefined
            ? {}
            : { refreshToken: completion.credentials.refreshToken }),
          ...(completion.credentials.tokenExpiresAt === undefined
            ? {}
            : { tokenExpiresAt: completion.credentials.tokenExpiresAt }),
          ...(completion.credentials.baseUrl === undefined
            ? {}
            : { baseUrl: completion.credentials.baseUrl }),
          ...(completion.externalAccountId === null
            ? {}
            : { externalAccountId: completion.externalAccountId }),
          settings: { transcriptSharing: false },
        },
      );
      this.redirect(response, addResult(completion.returnUrl, 'connected', this.config));
    } catch {
      this.redirect(response, addResult(null, 'failed', this.config));
    }
  }

  private redirect(response: NodeResponse, location: string): void {
    response.statusCode = 302;
    response.setHeader('Location', location);
    response.end();
  }
}

function addResult(returnUrl: string | null, result: string, config: AppConfig): string {
  const target = new URL(returnUrl ?? '/', config.publicUrl);
  target.searchParams.set('crm_oauth', result);
  return target.toString();
}
