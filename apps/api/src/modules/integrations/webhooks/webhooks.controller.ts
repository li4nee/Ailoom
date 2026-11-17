// SPDX-License-Identifier: AGPL-3.0-only
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import type { CreatedWebhook, WebhookDeliveryDto, WebhookDto } from '@app/shared';
import { createWebhookRequestSchema } from '@app/shared';

import { asWorkspaceId } from '../../../db/ids';
import { CurrentPrincipal, RequireRole, type Principal } from '../../auth';
import { WebhooksService } from './webhooks.service';

class CreateWebhookDto extends createZodDto(createWebhookRequestSchema) {}

@RequireRole('admin')
@Controller('v1/workspaces/:workspaceId/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string): Promise<WebhookDto[]> {
    return this.webhooks.list(asWorkspaceId(workspaceId));
  }

  @Post()
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateWebhookDto,
  ): Promise<CreatedWebhook> {
    return this.webhooks.create(asWorkspaceId(workspaceId), principal.userId, body);
  }

  @Post(':webhookId/rotate')
  rotate(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<CreatedWebhook> {
    return this.webhooks.rotate(asWorkspaceId(workspaceId), principal.userId, webhookId);
  }

  @Post(':webhookId/pause')
  pause(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<WebhookDto> {
    return this.webhooks.setStatus(
      asWorkspaceId(workspaceId),
      principal.userId,
      webhookId,
      'paused',
    );
  }

  @Post(':webhookId/resume')
  resume(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<WebhookDto> {
    return this.webhooks.setStatus(
      asWorkspaceId(workspaceId),
      principal.userId,
      webhookId,
      'active',
    );
  }

  @Post(':webhookId/test')
  @HttpCode(HttpStatus.OK)
  test(
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<{ ok: boolean; statusCode: number }> {
    return this.webhooks.test(asWorkspaceId(workspaceId), webhookId);
  }

  @Get(':webhookId/deliveries')
  deliveries(
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<WebhookDeliveryDto[]> {
    return this.webhooks.listDeliveries(asWorkspaceId(workspaceId), webhookId);
  }

  @Post(':webhookId/deliveries/:deliveryId/replay')
  @HttpCode(HttpStatus.NO_CONTENT)
  async replay(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
    @Param('deliveryId') deliveryId: string,
  ): Promise<void> {
    await this.webhooks.replay(asWorkspaceId(workspaceId), principal.userId, webhookId, deliveryId);
  }

  @Delete(':webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('workspaceId') workspaceId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<void> {
    await this.webhooks.remove(asWorkspaceId(workspaceId), principal.userId, webhookId);
  }
}
