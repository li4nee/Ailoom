// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  botToolDtoSchema,
  createBotToolSchema,
  createBotToolRequestSchema,
  updateBotToolRequestSchema,
  type BotToolDto,
  type CreateBotToolRequest,
  type TraceToolCall,
} from '@app/shared';

import { APP_CONFIG, type AppConfig } from '../../common/config';
import { SecretBox } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { newId } from '../../common/ids';
import { AUDIT_LOG, type AuditWriter } from '../../common/ports/audit';
import type { UserId, WorkspaceId } from '../../db/ids';
import type { ProviderToolDefinition } from '../../providers';
import { BotsService } from '../bots';
import { BotToolEntity } from './bot-tool.entity';
import { executeReadOnlyTool } from './tool-executor';
import { modelInputSchema } from './tool-policy';
import { ToolsRepository } from './tools.repository';

@Injectable()
export class ToolsService {
  constructor(
    private readonly ds: DataSource,
    private readonly bots: BotsService,
    private readonly repository: ToolsRepository,
    private readonly secrets: SecretBox,
    @Inject(AUDIT_LOG) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(workspaceId: WorkspaceId, botId: string): Promise<BotToolDto[]> {
    await this.bots.get(workspaceId, botId);
    return (await this.repository.listForBot(workspaceId, botId)).map(toDto);
  }

  async enabledForBot(workspaceId: WorkspaceId, botId: string): Promise<BotToolDto[]> {
    return (await this.list(workspaceId, botId)).filter((tool) => tool.enabled);
  }

  async botModelsSupportTools(workspaceId: WorkspaceId, botId: string): Promise<boolean> {
    return this.bots.supportsToolCalling(workspaceId, botId);
  }

  /** Re-read immediately before execution so a disabled or changed tool cannot use stale config. */
  async executeByName(
    workspaceId: WorkspaceId,
    botId: string,
    conversationId: string | null,
    turnId: string,
    toolId: string,
    name: string,
    expectedVersion: number,
    input: unknown,
    signal: AbortSignal,
    traceCalls: TraceToolCall[],
  ): Promise<Record<string, unknown>> {
    const row = await this.repository.findByName(workspaceId, botId, name);
    if (row === null) throw new AppError('not_found');
    if (row.id !== toolId || row.version !== expectedVersion) {
      throw new AppError('conflict');
    }
    const tool = toDto(row);
    if (!tool.enabled) throw new AppError('not_found');
    const auth = await this.openAuth(workspaceId, tool);
    const invocationId = newId();
    const startedAt = Date.now();
    const inputRecord =
      input !== null && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const inputFields = tool.inputs
      .filter((field) => Object.prototype.hasOwnProperty.call(inputRecord, field.name))
      .map((field) => field.name);
    await this.repository.insertInvocation({
      id: invocationId,
      workspaceId,
      botId,
      toolId,
      toolVersion: tool.version,
      conversationId,
      turnId,
      traceId: null,
      name,
      inputFields,
      outputFields: [],
      status: 'started',
      errorCode: null,
      startedAt: new Date(startedAt),
    });
    const summary: TraceToolCall = {
      name,
      toolVersion: tool.version,
      inputFields,
      outputFields: [],
      status: 'started',
      durationMs: null,
    };
    traceCalls.push(summary);
    try {
      const result = await executeReadOnlyTool(
        tool,
        input,
        signal,
        false,
        auth,
        this.config.nodeEnv !== 'production',
      );
      summary.status = 'complete';
      summary.outputFields = Object.keys(result);
      summary.durationMs = Math.max(0, Date.now() - startedAt);
      await this.repository.finishInvocation(workspaceId, invocationId, {
        outputFields: summary.outputFields,
        status: 'complete',
        durationMs: summary.durationMs,
      });
      return result;
    } catch (error) {
      summary.status = 'failed';
      summary.durationMs = Math.max(0, Date.now() - startedAt);
      await this.repository.finishInvocation(workspaceId, invocationId, {
        outputFields: [],
        status: 'failed',
        durationMs: summary.durationMs,
        errorCode: error instanceof AppError ? error.code : 'internal_error',
      });
      throw error;
    }
  }

  toModelSchema(tool: Pick<BotToolDto, 'inputs'>): ProviderToolDefinition['inputSchema'] {
    return modelInputSchema(tool) as unknown as ProviderToolDefinition['inputSchema'];
  }

  async get(workspaceId: WorkspaceId, botId: string, toolId: string): Promise<BotToolDto> {
    await this.bots.get(workspaceId, botId);
    const row = await this.repository.getById(workspaceId, toolId);
    if (row.botId !== botId) throw new AppError('not_found');
    return toDto(row);
  }

  async create(
    workspaceId: WorkspaceId,
    botId: string,
    input: CreateBotToolRequest,
    actor: UserId,
  ): Promise<BotToolDto> {
    await this.bots.get(workspaceId, botId);
    const parsed = createBotToolRequestSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (parsed.data.enabled) throw new AppError('validation_failed');
    const config = createBotToolSchema.parse(parsed.data);
    this.assertMockAllowed(config);
    const row = await this.ds.transaction(async (manager) => {
      const created = await this.repository.insert(
        workspaceId,
        {
          botId,
          name: config.name,
          definition: config,
          version: 1,
        },
        manager,
      );
      await this.repository.insertVersion(
        workspaceId,
        botId,
        created.id,
        created.version,
        created.definition,
        manager,
      );
      if (config.authHeaderName !== null && typeof parsed.data.authToken === 'string') {
        await this.repository.insertAuthSecret(
          workspaceId,
          created.id,
          created.version,
          config.authHeaderName,
          this.secrets.seal(parsed.data.authToken),
          manager,
        );
      }
      return created;
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actor,
      action: 'bot.tool_created',
      targetType: 'bot_tool',
      targetId: row.id,
      metadata: {
        botId,
        name: row.name,
        enabled: config.enabled,
        hasAuth: config.authHeaderName !== null,
      },
    });
    return toDto(row);
  }

  async update(
    workspaceId: WorkspaceId,
    botId: string,
    toolId: string,
    input: Partial<CreateBotToolRequest>,
    actor: UserId,
  ): Promise<BotToolDto> {
    const patch = updateBotToolRequestSchema.safeParse(input);
    if (!patch.success) throw validationError(patch.error);
    // Zod defaults in the partial config schema can materialize omitted fields. Only apply
    // values the caller actually supplied, or an enable/disable-only patch could reset a
    // custom timeout or development fixture to its create-time default.
    const changes = Object.fromEntries(
      Object.keys(input).flatMap((key) =>
        Object.hasOwn(patch.data, key) ? [[key, patch.data[key as keyof typeof patch.data]]] : [],
      ),
    ) as Partial<CreateBotToolRequest>;
    const updated = await this.ds.transaction(async (manager) => {
      const currentRow = await this.repository.versionForUpdate(workspaceId, toolId, manager);
      if (currentRow?.botId !== botId) throw new AppError('not_found');
      const current = toDto(currentRow);
      const parsed = createBotToolSchema.safeParse({ ...current, ...changes });
      if (!parsed.success) throw validationError(parsed.error);
      const config = parsed.data;
      this.assertMockAllowed(config);
      if (config.enabled && !(await this.bots.supportsToolCalling(workspaceId, botId))) {
        throw new AppError('validation_failed', {
          message:
            'The bot primary and fallback models must be in the reviewed tool-calling catalog.',
          details: [
            {
              path: 'enabled',
              message: 'Select a reviewed tool-calling model for the bot and its fallback.',
            },
          ],
        });
      }
      const oldSecret = await this.repository.getAuthSecret(
        workspaceId,
        toolId,
        currentRow.version,
        manager,
      );
      let nextSecret = null;
      if (config.authHeaderName !== null) {
        if (typeof changes.authToken === 'string') {
          nextSecret = this.secrets.seal(changes.authToken);
        } else if (changes.authToken === null || oldSecret?.headerName !== config.authHeaderName) {
          throw new AppError('validation_failed');
        } else {
          nextSecret = oldSecret;
        }
      } else if (changes.authToken !== undefined && changes.authToken !== null) {
        throw new AppError('validation_failed');
      }
      const nextTestHash = definitionHash(config);
      const authChanged =
        typeof changes.authToken === 'string' ||
        changes.authToken === null ||
        config.authHeaderName !== current.authHeaderName;
      if (config.enabled && (currentRow.testedDefinitionHash !== nextTestHash || authChanged)) {
        const changedFields = Object.keys(config).filter(
          (key) =>
            key !== 'enabled' &&
            JSON.stringify(current[key as keyof typeof current]) !==
              JSON.stringify(config[key as keyof typeof config]),
        );
        throw new AppError('validation_failed', {
          message: 'Run the tool test again before enabling it.',
          details: [
            {
              path: 'enabled',
              message: `The tested tool definition has changed${changedFields.length > 0 ? `: ${changedFields.join(', ')}` : ' (canonical digest mismatch)'}.`,
            },
          ],
        });
      }
      const nextVersion = currentRow.version + 1;
      const saved = await this.repository.updateById(
        workspaceId,
        toolId,
        {
          name: config.name,
          definition: config as never,
          version: nextVersion,
          testedDefinitionHash:
            currentRow.testedDefinitionHash === nextTestHash && !authChanged
              ? currentRow.testedDefinitionHash
              : null,
          testedAt:
            currentRow.testedDefinitionHash === nextTestHash && !authChanged
              ? currentRow.testedAt
              : null,
        },
        manager,
      );
      await this.repository.insertVersion(workspaceId, botId, toolId, nextVersion, config, manager);
      if (nextSecret !== null && config.authHeaderName !== null) {
        await this.repository.insertAuthSecret(
          workspaceId,
          toolId,
          nextVersion,
          config.authHeaderName,
          nextSecret,
          manager,
        );
      }
      return saved;
    });
    await this.audit.record({
      workspaceId,
      actorUserId: actor,
      action: 'bot.tool_updated',
      targetType: 'bot_tool',
      targetId: toolId,
      metadata: {
        botId,
        name: updated.name,
        enabled: toDto(updated).enabled,
        hasAuth: toDto(updated).hasAuth,
      },
    });
    return toDto(updated);
  }

  async remove(
    workspaceId: WorkspaceId,
    botId: string,
    toolId: string,
    actor: UserId,
  ): Promise<void> {
    await this.get(workspaceId, botId, toolId);
    await this.repository.deleteById(workspaceId, toolId);
    await this.audit.record({
      workspaceId,
      actorUserId: actor,
      action: 'bot.tool_deleted',
      targetType: 'bot_tool',
      targetId: toolId,
      metadata: { botId },
    });
  }

  async test(
    workspaceId: WorkspaceId,
    botId: string,
    toolId: string,
    actor: UserId,
  ): Promise<Record<string, unknown>> {
    const tool = await this.get(workspaceId, botId, toolId);
    let result: Record<string, unknown>;
    try {
      const auth = await this.openAuth(workspaceId, tool);
      result = await executeReadOnlyTool(
        tool,
        tool.testArguments,
        AbortSignal.timeout(tool.timeoutMs),
        true,
        auth,
        this.config.nodeEnv !== 'production',
      );
      await this.ds.transaction(async (manager) => {
        const current = await this.repository.versionForUpdate(workspaceId, toolId, manager);
        if (current?.botId !== botId) throw new AppError('not_found');
        if (current.version !== tool.version) throw new AppError('conflict');
        await this.repository.updateById(
          workspaceId,
          toolId,
          {
            testedDefinitionHash: definitionHash(tool),
            testedAt: new Date(),
          },
          manager,
        );
      });
    } catch (error) {
      await this.audit.record({
        workspaceId,
        actorUserId: actor,
        action: 'bot.tool_tested',
        targetType: 'bot_tool',
        targetId: toolId,
        metadata: {
          botId,
          name: tool.name,
          status: 'failed',
          errorCode: error instanceof AppError ? error.code : 'internal_error',
        },
      });
      throw error;
    }
    await this.audit.record({
      workspaceId,
      actorUserId: actor,
      action: 'bot.tool_tested',
      targetType: 'bot_tool',
      targetId: toolId,
      metadata: {
        botId,
        name: tool.name,
        status: 'complete',
        resultFields: Object.keys(result),
      },
    });
    return result;
  }

  private async openAuth(
    workspaceId: WorkspaceId,
    tool: BotToolDto,
  ): Promise<{ headerName: string; token: string } | null> {
    if (!tool.hasAuth) return null;
    const sealed = await this.repository.getAuthSecret(workspaceId, tool.id, tool.version);
    if (sealed?.headerName !== tool.authHeaderName) {
      throw new AppError('internal_error');
    }
    try {
      return { headerName: sealed.headerName, token: this.secrets.open(sealed) };
    } catch {
      throw new AppError('internal_error');
    }
  }

  private assertMockAllowed(config: { mockResponse: Record<string, unknown> | null }): void {
    if (this.config.nodeEnv === 'production' && config.mockResponse !== null) {
      throw new AppError('validation_failed', {
        message: 'Mock tool responses are available only in development and test.',
        details: [{ path: 'mockResponse', message: 'Use a live HTTPS endpoint in production.' }],
      });
    }
  }
}

function toDto(row: BotToolEntity): BotToolDto {
  return botToolDtoSchema.parse({
    ...row.definition,
    id: row.id,
    botId: row.botId,
    version: row.version,
    hasAuth: typeof row.definition['authHeaderName'] === 'string',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    testedAt: row.testedAt?.toISOString() ?? null,
  });
}

/** Stable config digest; enablement is an operational switch, not part of the tested behavior. */
function definitionHash(tool: CreateBotToolRequest): string {
  const normalized = createBotToolSchema.parse(tool);
  const definition = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => key !== 'enabled'),
  );
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  return createHash('sha256').update(canonical(definition)).digest('hex');
}

function validationError(error: { issues: { path: PropertyKey[]; message: string }[] }): AppError {
  return new AppError('validation_failed', {
    details: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}
