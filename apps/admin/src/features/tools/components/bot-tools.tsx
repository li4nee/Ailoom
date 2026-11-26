// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  createBotToolSchema,
  type BotToolDto,
  type CreateBotToolRequest,
  type McpDiscoveryResult,
} from '@app/shared';

import {
  useBotTools,
  useDeleteBotTool,
  useDiscoverMcpTools,
  useSaveBotTool,
  useTestBotTool,
} from '../api';

interface Draft {
  transport: 'http' | 'mcp';
  name: string;
  description: string;
  useWhen: string;
  neverUse: string;
  failureBehavior: string;
  enabled: boolean;
  endpoint: string;
  remoteToolName: string;
  remoteSchemaSnapshot: string;
  remoteDescriptionSnapshot: string;
  schemaApproved: boolean;
  readOnlyApproved: boolean;
  authHeaderName: string;
  authToken: string;
  hasAuth: boolean;
  clearAuth: boolean;
  inputs: string;
  query: string;
  responseFields: string;
  mockResponse: string;
  timeoutMs: string;
  maxCalls: string;
  testArguments: string;
}

const emptyDraft = (): Draft => ({
  transport: 'http',
  name: '',
  description: '',
  useWhen: '',
  neverUse: '',
  failureBehavior: '',
  enabled: false,
  endpoint: '',
  remoteToolName: '',
  remoteSchemaSnapshot: 'null',
  remoteDescriptionSnapshot: 'null',
  schemaApproved: false,
  readOnlyApproved: false,
  authHeaderName: '',
  authToken: '',
  hasAuth: false,
  clearAuth: false,
  inputs: '[]',
  query: '[]',
  responseFields: '[]',
  mockResponse: 'null',
  timeoutMs: '5000',
  maxCalls: '1',
  testArguments: '{}',
});

function fromTool(tool: BotToolDto): Draft {
  return {
    transport: tool.transport,
    name: tool.name,
    description: tool.description,
    useWhen: tool.useWhen,
    neverUse: tool.neverUse,
    failureBehavior: tool.failureBehavior,
    enabled: tool.enabled,
    endpoint: tool.endpoint,
    remoteToolName: tool.remoteToolName ?? '',
    remoteSchemaSnapshot: JSON.stringify(tool.remoteSchemaSnapshot, null, 2),
    remoteDescriptionSnapshot: JSON.stringify(tool.remoteDescriptionSnapshot, null, 2),
    schemaApproved: tool.schemaApproved,
    readOnlyApproved: tool.readOnlyApproved,
    authHeaderName: tool.authHeaderName ?? '',
    authToken: '',
    hasAuth: tool.hasAuth,
    clearAuth: false,
    inputs: JSON.stringify(tool.inputs, null, 2),
    query: JSON.stringify(tool.query, null, 2),
    responseFields: JSON.stringify(tool.responseFields, null, 2),
    mockResponse: JSON.stringify(tool.mockResponse, null, 2),
    timeoutMs: String(tool.timeoutMs),
    maxCalls: String(tool.maxCalls),
    testArguments: JSON.stringify(tool.testArguments, null, 2),
  };
}

function json(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(strings.tools.invalidJson(label));
  }
}

function toRequest(draft: Draft): CreateBotToolRequest {
  const config = createBotToolSchema.parse({
    transport: draft.transport,
    name: draft.name,
    description: draft.description,
    useWhen: draft.useWhen,
    neverUse: draft.neverUse,
    failureBehavior: draft.failureBehavior,
    enabled: draft.enabled,
    endpoint: draft.endpoint,
    remoteToolName: draft.remoteToolName || null,
    remoteSchemaSnapshot: json(draft.remoteSchemaSnapshot, 'Remote schema snapshot'),
    remoteDescriptionSnapshot: json(draft.remoteDescriptionSnapshot, 'Remote description snapshot'),
    schemaApproved: draft.schemaApproved,
    readOnlyApproved: draft.readOnlyApproved,
    authHeaderName: draft.clearAuth ? null : draft.authHeaderName.trim() || null,
    inputs: json(draft.inputs, 'Inputs'),
    query: json(draft.query, 'Query bindings'),
    responseFields: json(draft.responseFields, 'Response fields'),
    mockResponse: json(draft.mockResponse, 'Mock response'),
    timeoutMs: Number(draft.timeoutMs),
    maxCalls: Number(draft.maxCalls),
    testArguments: json(draft.testArguments, 'Test arguments'),
  });
  return {
    ...config,
    ...(draft.clearAuth
      ? { authToken: null }
      : draft.authToken === ''
        ? {}
        : { authToken: draft.authToken }),
  };
}

function TextArea({
  id,
  value,
  onChange,
  disabled,
  rows = 6,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  rows?: number;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-55"
    />
  );
}

export function BotTools({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const tools = useBotTools(workspaceId, botId);
  const save = useSaveBotTool(workspaceId, botId);
  const remove = useDeleteBotTool(workspaceId, botId);
  const test = useTestBotTool(workspaceId, botId);
  const discover = useDiscoverMcpTools(workspaceId, botId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [discovered, setDiscovered] = useState<McpDiscoveryResult | null>(null);
  const selected = useMemo(
    () => tools.data?.find((tool) => tool.id === selectedId),
    [tools.data, selectedId],
  );
  const hasUnsavedChanges =
    JSON.stringify(draft) !== JSON.stringify(selected ? fromTool(selected) : emptyDraft());
  const preview = useMemo(() => {
    try {
      return createBotToolSchema.parse({
        ...draft,
        remoteToolName: draft.remoteToolName || null,
        remoteSchemaSnapshot: json(draft.remoteSchemaSnapshot, 'Remote schema snapshot'),
        remoteDescriptionSnapshot: json(
          draft.remoteDescriptionSnapshot,
          'Remote description snapshot',
        ),
        inputs: json(draft.inputs, 'Inputs'),
        query: json(draft.query, 'Query bindings'),
        responseFields: json(draft.responseFields, 'Response fields'),
        mockResponse: json(draft.mockResponse, 'Mock response'),
        timeoutMs: Number(draft.timeoutMs),
        maxCalls: Number(draft.maxCalls),
        testArguments: json(draft.testArguments, 'Test arguments'),
      });
    } catch {
      return null;
    }
  }, [draft]);

  if (tools.isError) return <FormAlert message={errorMessage(tools.error)} />;
  if (tools.isPending) return <Skeleton className="h-40 w-full" />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    const reviewInvalidated = [
      'transport',
      'endpoint',
      'remoteToolName',
      'description',
      'inputs',
      'authHeaderName',
      'authToken',
    ].includes(key);
    const discoveryInvalidated = ['endpoint', 'authHeaderName', 'authToken'].includes(key);
    setFormError(null);
    setTestResult(null);
    if (discoveryInvalidated) setDiscovered(null);
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === 'enabled' ? {} : { enabled: false }),
      ...(reviewInvalidated ? { schemaApproved: false, readOnlyApproved: false } : {}),
    }));
  };
  const choose = (tool: BotToolDto) => {
    setSelectedId(tool.id);
    setDraft(fromTool(tool));
    setFormError(null);
    setTestResult(null);
    setDiscovered(null);
  };
  const reset = () => {
    setSelectedId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setTestResult(null);
    setDiscovered(null);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.6fr)]">
      <aside className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">{strings.tools.title}</h2>
            <p className="text-sm text-muted-foreground">{strings.tools.intro}</p>
          </div>
          {hasUnsavedChanges ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline" size="sm" disabled={!isAdmin}>
                  {strings.tools.new}
                </Button>
              }
              title={strings.tools.discardTitle}
              description={strings.tools.discardDescription}
              confirmLabel={strings.tools.discardChanges}
              destructive={false}
              error={null}
              pending={false}
              onConfirm={(close) => {
                close();
                reset();
              }}
            />
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={!isAdmin} onClick={reset}>
              {strings.tools.new}
            </Button>
          )}
        </div>
        {tools.data.length === 0 ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">
            {strings.tools.empty}
          </p>
        ) : (
          <ul className="space-y-2">
            {tools.data.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button"
                  onClick={() => {
                    choose(tool);
                  }}
                  className={`w-full rounded-md border p-3 text-left active:translate-y-px ${selectedId === tool.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm">{tool.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {strings.tools.version(tool.version)} ·{' '}
                      {tool.enabled ? strings.tools.enabled : strings.tools.disabled}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {tool.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          setFormError(null);
          try {
            save.mutate(
              { ...(selectedId === null ? {} : { id: selectedId }), definition: toRequest(draft) },
              {
                onSuccess: (saved) => {
                  choose(saved);
                },
              },
            );
          } catch (error) {
            setFormError(error instanceof Error ? error.message : strings.tools.invalidSettings);
          }
        }}
      >
        <section className="space-y-4 rounded-md border p-4">
          <div>
            <h3 className="font-medium">{strings.tools.purpose}</h3>
            <p className="text-sm text-muted-foreground">{strings.tools.purposeHelp}</p>
          </div>
          <Field
            id="tool-name"
            label={strings.tools.name}
            value={draft.name}
            disabled={!isAdmin}
            onChange={(v) => {
              set('name', v);
            }}
          />
          <Field
            id="tool-description"
            label={strings.tools.description}
            value={draft.description}
            disabled={!isAdmin}
            onChange={(v) => {
              set('description', v);
            }}
          />
          <AreaField
            id="tool-use-when"
            label={strings.tools.useWhen}
            value={draft.useWhen}
            disabled={!isAdmin}
            onChange={(v) => {
              set('useWhen', v);
            }}
          />
          <AreaField
            id="tool-never-use"
            label={strings.tools.neverUse}
            value={draft.neverUse}
            disabled={!isAdmin}
            onChange={(v) => {
              set('neverUse', v);
            }}
          />
          <AreaField
            id="tool-failure"
            label={strings.tools.failureBehavior}
            value={draft.failureBehavior}
            disabled={!isAdmin}
            onChange={(v) => {
              set('failureBehavior', v);
            }}
          />
        </section>

        <section className="space-y-4 rounded-md border p-4">
          <div>
            <h3 className="font-medium">{strings.tools.connectionInputs}</h3>
            <p className="text-sm text-muted-foreground">
              {draft.transport === 'mcp'
                ? strings.tools.mcpConnectionHelp
                : strings.tools.connectionHelp}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tool-transport">{strings.tools.transport}</Label>
            <select
              id="tool-transport"
              value={draft.transport}
              disabled={!isAdmin || selectedId !== null}
              onChange={(event) => {
                const transport = event.target.value === 'mcp' ? 'mcp' : 'http';
                setDraft((current) => ({
                  ...current,
                  transport,
                  enabled: false,
                  remoteToolName: '',
                  remoteSchemaSnapshot: 'null',
                  remoteDescriptionSnapshot: 'null',
                  schemaApproved: false,
                  readOnlyApproved: false,
                  query: '[]',
                  mockResponse: 'null',
                }));
                setDiscovered(null);
                setTestResult(null);
              }}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="http">{strings.tools.httpTransport}</option>
              <option value="mcp">{strings.tools.mcpTransport}</option>
            </select>
          </div>
          <Field
            id="tool-endpoint"
            label={strings.tools.endpoint}
            value={draft.endpoint}
            disabled={!isAdmin}
            onChange={(v) => {
              set('endpoint', v);
            }}
          />
          <Field
            id="tool-auth-header"
            label={strings.tools.authHeader}
            value={draft.authHeaderName}
            disabled={!isAdmin || draft.clearAuth}
            onChange={(v) => {
              set('authHeaderName', v);
            }}
          />
          <Field
            id="tool-auth-token"
            label={strings.tools.authToken}
            type="password"
            value={draft.authToken}
            disabled={!isAdmin || draft.clearAuth}
            onChange={(v) => {
              set('authToken', v);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {draft.hasAuth ? strings.tools.authExistingHelp : strings.tools.authHelp}
          </p>
          {draft.transport === 'mcp' ? (
            <>
              <p className="text-xs text-muted-foreground">{strings.tools.discoveryHelp}</p>
              <Button
                type="button"
                variant="outline"
                disabled={!isAdmin || discover.isPending || draft.endpoint.trim() === ''}
                onClick={() => {
                  setFormError(null);
                  discover.mutate(
                    {
                      ...(selectedId !== null && selected?.transport === 'mcp'
                        ? { toolId: selectedId }
                        : {}),
                      endpoint: draft.endpoint,
                      authHeaderName: draft.clearAuth ? null : draft.authHeaderName.trim() || null,
                      ...(draft.authToken === '' ? {} : { authToken: draft.authToken }),
                      timeoutMs: Number(draft.timeoutMs),
                    },
                    { onSuccess: setDiscovered },
                  );
                }}
              >
                {discover.isPending ? strings.tools.discovering : strings.tools.discover}
              </Button>
              {discover.error ? <FormAlert message={errorMessage(discover.error)} /> : null}
              {discovered !== null ? (
                <div className="space-y-2 rounded-md border p-3">
                  <h4 className="text-sm font-medium">{strings.tools.discoveredTools}</h4>
                  {discovered.unsupportedCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {strings.tools.unsupportedTools(discovered.unsupportedCount)}
                    </p>
                  ) : null}
                  {discovered.tools.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {strings.tools.noSupportedTools}
                    </p>
                  ) : null}
                  <ul className="space-y-2">
                    {discovered.tools.map((remote) => (
                      <li key={remote.name}>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto w-full justify-start whitespace-normal p-3 text-left"
                          onClick={() => {
                            const localName = `mcp_${remote.name}`
                              .toLowerCase()
                              .replace(/[^a-z0-9_]/g, '_')
                              .slice(0, 40);
                            setDraft((current) => ({
                              ...current,
                              name: localName,
                              description: remote.description.slice(0, 300) || remote.name,
                              remoteToolName: remote.name,
                              remoteSchemaSnapshot: JSON.stringify(remote.inputs, null, 2),
                              remoteDescriptionSnapshot: JSON.stringify(remote.description),
                              inputs: JSON.stringify(remote.inputs, null, 2),
                              query: '[]',
                              mockResponse: 'null',
                              schemaApproved: false,
                              readOnlyApproved: false,
                              enabled: false,
                            }));
                            setTestResult(null);
                          }}
                        >
                          <span className="block">
                            <span className="block font-mono text-xs">{remote.name}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {remote.description || strings.tools.none}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {strings.tools.readOnlyHint(remote.readOnlyHint)} ·{' '}
                              {remote.inputs.length} inputs
                            </span>
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {selected?.transport === 'mcp' ? (
                    <p className="text-xs text-muted-foreground" role="status">
                      {(() => {
                        const remote = discovered.tools.find(
                          (item) => item.name === selected.remoteToolName,
                        );
                        if (remote === undefined) return strings.tools.remoteToolMissing;
                        const schemaChanged =
                          JSON.stringify(remote.inputs) !==
                          JSON.stringify(selected.remoteSchemaSnapshot);
                        const descriptionChanged =
                          remote.description !== selected.remoteDescriptionSnapshot;
                        return schemaChanged || descriptionChanged
                          ? strings.tools.remoteToolChanged
                          : strings.tools.remoteToolUnchanged;
                      })()}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {draft.remoteToolName !== '' ? (
                <>
                  <Field
                    id="tool-remote-name"
                    label={strings.tools.remoteTool}
                    value={draft.remoteToolName}
                    disabled
                    onChange={() => undefined}
                  />
                  <p className="text-xs text-muted-foreground">{strings.tools.mcpCaution}</p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.schemaApproved}
                      disabled={!isAdmin}
                      onChange={(event) => {
                        set('schemaApproved', event.target.checked);
                      }}
                    />
                    {strings.tools.reviewSchema}
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.readOnlyApproved}
                      disabled={!isAdmin}
                      onChange={(event) => {
                        set('readOnlyApproved', event.target.checked);
                      }}
                    />
                    {strings.tools.approveReadOnly}
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          {draft.hasAuth ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.clearAuth}
                disabled={!isAdmin}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    enabled: false,
                    schemaApproved: false,
                    readOnlyApproved: false,
                    clearAuth: event.target.checked,
                    authHeaderName: event.target.checked ? '' : current.authHeaderName,
                    authToken: '',
                  }));
                  setDiscovered(null);
                  setTestResult(null);
                }}
              />
              {strings.tools.clearAuth}
            </label>
          ) : null}
          <JsonField
            id="tool-inputs"
            label={strings.tools.modelInputs}
            help={strings.tools.modelInputsHelp}
            value={draft.inputs}
            disabled={!isAdmin}
            onChange={(v) => {
              set('inputs', v);
            }}
          />
          {draft.transport === 'http' ? (
            <JsonField
              id="tool-query"
              label={strings.tools.queryBindings}
              help={strings.tools.queryBindingsHelp}
              value={draft.query}
              disabled={!isAdmin}
              onChange={(v) => {
                set('query', v);
              }}
            />
          ) : null}
        </section>

        <section className="space-y-4 rounded-md border p-4">
          <div>
            <h3 className="font-medium">{strings.tools.responseLimits}</h3>
            <p className="text-sm text-muted-foreground">{strings.tools.responseHelp}</p>
          </div>
          <JsonField
            id="tool-response-fields"
            label={strings.tools.responseFields}
            help={strings.tools.responseFieldsHelp}
            value={draft.responseFields}
            disabled={!isAdmin}
            onChange={(v) => {
              set('responseFields', v);
            }}
          />
          {draft.transport === 'http' ? (
            <JsonField
              id="tool-mock-response"
              label={strings.tools.mockResponse}
              help={strings.tools.mockResponseHelp}
              value={draft.mockResponse}
              disabled={!isAdmin}
              onChange={(v) => {
                set('mockResponse', v);
              }}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="tool-timeout"
              label={strings.tools.timeout}
              type="number"
              value={draft.timeoutMs}
              disabled={!isAdmin}
              onChange={(v) => {
                set('timeoutMs', v);
              }}
            />
            <Field
              id="tool-max-calls"
              label={strings.tools.maxCalls}
              type="number"
              value={draft.maxCalls}
              disabled={!isAdmin}
              onChange={(v) => {
                set('maxCalls', v);
              }}
            />
          </div>
          <JsonField
            id="tool-test-arguments"
            label={strings.tools.testArguments}
            help={strings.tools.testArgumentsHelp}
            value={draft.testArguments}
            disabled={!isAdmin}
            onChange={(v) => {
              set('testArguments', v);
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!isAdmin || selected === undefined || selected.testedAt === null}
              onChange={(event) => {
                set('enabled', event.target.checked);
              }}
            />
            {strings.tools.enable}
          </label>
          <p className="text-xs text-muted-foreground">{strings.tools.enableGate}</p>
        </section>

        {preview === null ? null : (
          <section className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4">
            <div>
              <h3 className="font-medium">{strings.tools.preview}</h3>
              <p className="text-sm text-muted-foreground">{strings.tools.previewHelp}</p>
            </div>
            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <PreviewBlock
                title={strings.tools.modelArgs}
                value={
                  preview.inputs.map((field) => `${field.name}: ${field.type}`).join('\n') ||
                  strings.tools.none
                }
              />
              <PreviewBlock
                title={strings.tools.remoteQuery}
                value={
                  preview.query
                    .map((binding) =>
                      binding.source === 'input'
                        ? `${binding.parameter} ← ${binding.input}`
                        : `${binding.parameter} ← fixed value`,
                    )
                    .join('\n') || strings.tools.noQuery
                }
              />
              <PreviewBlock
                title={strings.tools.authPreview}
                value={
                  preview.authHeaderName === null
                    ? strings.tools.none
                    : `${preview.authHeaderName} ← encrypted server secret`
                }
              />
              <PreviewBlock
                title={strings.tools.assistantResult}
                value={
                  preview.responseFields
                    .filter((field) => field.visibleToVisitor)
                    .map((field) => `${field.name} ← ${field.path}`)
                    .join('\n') || strings.tools.none
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {draft.transport === 'mcp'
                ? strings.tools.mcpPlatformCeiling
                : strings.tools.platformCeiling}{' '}
              This tool is currently{' '}
              {preview.enabled ? strings.tools.enabled : strings.tools.disabled}.
            </p>
          </section>
        )}

        <FormAlert message={formError ?? errorMessage(save.error)} />
        {remove.error ? <FormAlert message={errorMessage(remove.error)} /> : null}
        {hasUnsavedChanges ? (
          <p role="status" className="text-sm text-muted-foreground">
            {strings.tools.unsavedChanges}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!isAdmin || save.isPending}>
            {strings.tools.save}
          </Button>
          {selectedId !== null ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={
                  !isAdmin ||
                  test.isPending ||
                  hasUnsavedChanges ||
                  (draft.transport === 'mcp' && (!draft.schemaApproved || !draft.readOnlyApproved))
                }
                onClick={() => {
                  setTestResult(null);
                  test.mutate(selectedId, {
                    onSuccess: (result) => {
                      setTestResult(result);
                    },
                  });
                }}
              >
                {test.isPending ? strings.tools.testing : strings.tools.test}
              </Button>
              <span className="self-center text-xs text-muted-foreground">
                {selected === undefined || selected.testedAt === null
                  ? strings.tools.notTested
                  : strings.tools.lastTested(selected.testedAt)}
              </span>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="destructive" disabled={!isAdmin}>
                    {strings.tools.delete}
                  </Button>
                }
                title={strings.tools.deleteTitle(draft.name)}
                description={strings.tools.deleteDescription}
                confirmLabel={strings.tools.delete}
                error={errorMessage(remove.error)}
                pending={remove.isPending}
                onConfirm={(close) => {
                  remove.mutate(selectedId, {
                    onSuccess: () => {
                      close();
                      reset();
                    },
                  });
                }}
              />
            </>
          ) : null}
          {test.error ? <FormAlert message={errorMessage(test.error)} /> : null}
        </div>
        {testResult === null ? null : (
          <section className="space-y-2 rounded-md border bg-muted/20 p-4" aria-live="polite">
            <h3 className="font-medium">{strings.tools.testSucceeded}</h3>
            <pre className="overflow-auto rounded-md border bg-background p-3 text-xs">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </section>
        )}
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  disabled,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function AreaField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <TextArea id={id} value={value} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function JsonField({
  id,
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-xs text-muted-foreground">{help}</p>
      <TextArea id={id} value={value} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function PreviewBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <h4 className="font-medium">{title}</h4>
      <pre className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{value}</pre>
    </div>
  );
}
