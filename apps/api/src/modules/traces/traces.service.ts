// SPDX-License-Identifier: AGPL-3.0-only
import { Injectable } from '@nestjs/common';

import type { ProviderKind, TraceDetail } from '@app/shared';

import { AppError } from '../../common/errors';
import type { WorkspaceId } from '../../db/ids';
import { PricingService } from '../usage';
import { toTraceDetail } from './traces.mapper';
import { TracesRepository, type TraceDetailRow } from './traces.repository';

/** Read-side of the replay drawer (spec §17.8). Every lookup is workspace-scoped. */
@Injectable()
export class TracesService {
  constructor(
    private readonly traces: TracesRepository,
    private readonly pricing: PricingService,
  ) {}

  async get(workspaceId: WorkspaceId, traceId: string): Promise<TraceDetail> {
    const row = await this.traces.detail(workspaceId, traceId);
    if (row === null) throw new AppError('not_found');
    return this.toDetail(workspaceId, row);
  }

  async getForMessage(workspaceId: WorkspaceId, messageId: string): Promise<TraceDetail> {
    const trace = await this.traces.findByMessageId(workspaceId, messageId);
    if (trace === null) throw new AppError('not_found');
    return this.get(workspaceId, trace.id);
  }

  private async toDetail(workspaceId: WorkspaceId, row: TraceDetailRow): Promise<TraceDetail> {
    const retrieval = await this.traces.retrievalRows(workspaceId, row.id);
    const price = await this.pricing.cost(workspaceId, {
      ...(row.chat_provider === null || row.chat_model === null
        ? {}
        : {
            chat: {
              provider: row.chat_provider as ProviderKind,
              model: row.chat_model,
              inputTokens: row.input_tokens,
              outputTokens: row.output_tokens,
            },
          }),
      ...(row.embedding_provider === null || row.embedding_model === null
        ? {}
        : {
            embedding: {
              provider: row.embedding_provider as ProviderKind,
              model: row.embedding_model,
              tokens: row.embedding_tokens,
            },
          }),
    });
    return toTraceDetail(row, retrieval, price.priceKnown);
  }
}
