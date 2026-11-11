// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { WorkspacePurgeProcessor } from './workspace-purge.processor';
import { WorkspacePurgeRepository } from './workspace-purge.repository';

/**
 * The worker half of workspace deletion. Separate from `WorkspacesModule` so the worker does
 * not load the HTTP-facing services and their auth and audit dependencies.
 */
@Module({ providers: [WorkspacePurgeRepository, WorkspacePurgeProcessor] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class WorkspacePurgeModule {}
