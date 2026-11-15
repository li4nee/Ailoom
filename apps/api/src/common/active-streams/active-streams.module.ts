// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { ActiveStreams } from './active-streams';

/**
 * Separately importable so the conversations module (agent actions) and the chat module share
 * one registry without importing each other and forming a cycle.
 */
@Module({
  providers: [ActiveStreams],
  exports: [ActiveStreams],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class ActiveStreamsModule {}
