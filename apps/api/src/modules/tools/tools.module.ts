// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit';
import { BotsModule } from '../bots';
import { CredentialsModule } from '../credentials';
import { ToolsController } from './tools.controller';
import { ToolsRepository } from './tools.repository';
import { ToolsService } from './tools.service';

@Module({
  imports: [AuditModule, BotsModule, CredentialsModule],
  controllers: [ToolsController],
  providers: [ToolsRepository, ToolsService],
  exports: [ToolsRepository, ToolsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ToolsModule {}
