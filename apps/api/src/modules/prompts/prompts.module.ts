// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit';
import { BotsModule } from '../bots';
import { PromptVersionsRepository } from './prompt-versions.repository';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';

/** Prompt versions of a bot. Imports the bots module for the bot row it locks and activates. */
@Module({
  imports: [AuditModule, BotsModule],
  controllers: [PromptsController],
  providers: [PromptVersionsRepository, PromptsService],
  exports: [PromptVersionsRepository, PromptsService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class PromptsModule {}
