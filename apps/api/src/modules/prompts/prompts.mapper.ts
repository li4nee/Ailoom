// SPDX-License-Identifier: AGPL-3.0-only
import type { PromptVersionDto } from '@app/shared';

import type { PromptVersionEntity } from '../bots';

export function toPromptVersionDto(version: PromptVersionEntity): PromptVersionDto {
  return {
    id: version.id,
    botId: version.botId,
    version: version.version,
    systemPrompt: version.systemPrompt,
    note: version.note,
    createdAt: version.createdAt.toISOString(),
  };
}
