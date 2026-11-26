// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { SYSTEM_PROMPT_MAX, type PromptVersionDto } from '@app/shared';

import { useBot, useCreatePromptVersion, usePromptVersions } from '../api';
import { diffPrompt } from '../prompt-diff';
import { PromptRelease } from './prompt-release';

export function BotInstructions({
  workspaceId,
  botId,
  versionId = '',
}: {
  workspaceId: string;
  botId: string;
  versionId?: string;
}) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const versions = usePromptVersions(workspaceId, botId, isAdmin);
  const create = useCreatePromptVersion(workspaceId, botId);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [selection, setSelection] = useState(versionId);
  const [comparison, setComparison] = useState('live');
  const [notice, setNotice] = useState('');
  const rows = versions.data ?? [];
  const active = rows.find((row) => row.id === bot.data?.activePromptVersionId);
  const selected = rows.find((row) => row.id === selection) ?? rows[0];
  const base = comparison === 'live' ? active : rows.find((row) => row.id === comparison);
  const systemPrompt = draftText ?? active?.systemPrompt ?? '';

  if (!isAdmin)
    return (
      <p className="text-sm text-muted-foreground">Ask a workspace admin to manage instructions.</p>
    );
  if (versions.isError || bot.isError)
    return <FormAlert message={errorMessage(versions.error ?? bot.error)} />;
  if (versions.isPending || bot.isPending) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="max-w-5xl space-y-6">
      <form
        className="max-w-2xl space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            {
              systemPrompt,
              activate: false,
              ...(note.trim() === '' ? {} : { note: note.trim() }),
            },
            {
              onSuccess: (saved) => {
                setDraftText(null);
                setNote('');
                setSelection(saved.id);
                setComparison('live');
                setNotice(`Version ${String(saved.version)} saved for review.`);
              },
            },
          );
        }}
      >
        <p className="text-sm text-muted-foreground">{strings.bots.instructionsIntro}</p>
        <div className="space-y-2">
          <Label htmlFor="bot-instructions">{strings.bots.instructions}</Label>
          <textarea
            id="bot-instructions"
            className="min-h-48 w-full rounded-md border bg-background p-3 font-mono text-sm"
            value={systemPrompt}
            maxLength={SYSTEM_PROMPT_MAX}
            disabled={create.isPending}
            onChange={(event) => {
              setDraftText(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bot-instructions-note">{strings.bots.note}</Label>
          <Input
            id="bot-instructions-note"
            value={note}
            maxLength={200}
            disabled={create.isPending}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>
        <FormAlert message={errorMessage(create.error)} />
        <Button
          type="submit"
          disabled={create.isPending || systemPrompt === (active?.systemPrompt ?? '')}
        >
          {strings.bots.saveVersion}
        </Button>
      </form>

      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {notice}
      </p>
      <section className="space-y-3">
        <h3 className="font-medium">Prompt versions</h3>
        {rows.length === 0 || selected === undefined ? (
          <p className="text-sm text-muted-foreground">{strings.bots.emptyInstructions}</p>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <ol className="max-h-72 divide-y overflow-auto rounded-md border">
              {rows.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    className="w-full space-y-1 px-3 py-2 text-left text-sm hover:bg-muted aria-pressed:bg-muted"
                    aria-pressed={version.id === selected.id}
                    onClick={() => {
                      setSelection(version.id);
                      setComparison('live');
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{strings.bots.version(version.version)}</span>
                      {version.id === active?.id ? <Badge variant="secondary">Live</Badge> : null}
                    </span>
                    <time
                      className="block text-xs text-muted-foreground"
                      dateTime={version.createdAt}
                    >
                      {version.createdAt.slice(0, 10)}
                    </time>
                    {version.note ? (
                      <span className="block break-words text-xs">{version.note}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ol>

            <div className="min-w-0 space-y-4 rounded-md border p-4">
              <header className="flex flex-wrap items-end justify-between gap-3">
                <h4 className="font-medium">{strings.bots.version(selected.version)} changes</h4>
                <div className="space-y-1">
                  <Label htmlFor="prompt-compare">Compare against</Label>
                  <select
                    id="prompt-compare"
                    className="block min-h-9 rounded-md border bg-background px-2 text-sm"
                    value={comparison}
                    onChange={(event) => {
                      setComparison(event.target.value);
                    }}
                  >
                    <option value="live">
                      {active ? `Live · v${String(active.version)}` : 'Empty prompt'}
                    </option>
                    {rows
                      .filter((row) => row.id !== active?.id && row.id !== selected.id)
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {strings.bots.version(row.version)}
                        </option>
                      ))}
                  </select>
                </div>
              </header>
              <PromptDiff before={base} after={selected} />
              <PromptRelease
                key={selected.id}
                workspaceId={workspaceId}
                botId={botId}
                version={selected}
                active={active}
                onRelease={(message) => {
                  setComparison('live');
                  setNotice(message);
                }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PromptDiff({
  before,
  after,
}: {
  before: PromptVersionDto | undefined;
  after: PromptVersionDto;
}) {
  const original = before?.systemPrompt ?? '';
  const lines = useMemo(
    () => diffPrompt(original, after.systemPrompt),
    [original, after.systemPrompt],
  );
  return (
    <div className="space-y-2">
      {original === after.systemPrompt ? (
        <p className="text-sm text-muted-foreground">No differences.</p>
      ) : null}
      {lines.length > 0 ? (
        <pre
          aria-label="Prompt comparison"
          className="max-h-80 overflow-auto rounded-md border text-xs"
        >
          {lines.map((line, index) => (
            <span
              key={index}
              className={`block whitespace-pre-wrap break-words px-2 py-0.5 ${
                {
                  added: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                  removed: 'bg-destructive/10 text-destructive',
                  same: 'text-muted-foreground',
                }[line.kind]
              }`}
            >
              {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
              {line.text}
            </span>
          ))}
        </pre>
      ) : null}
    </div>
  );
}
