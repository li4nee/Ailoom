// SPDX-License-Identifier: AGPL-3.0-only
import { Module } from '@nestjs/common';

import { TracesRepository } from './traces.repository';

/** Generation traces (spec §9.5). */
@Module({
  providers: [TracesRepository],
  exports: [TracesRepository],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest module
export class TracesModule {}
