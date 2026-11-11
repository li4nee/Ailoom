// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useCreatePromptVersion, usePromptVersions } from '../api';

export function BotInstructions({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const versions = usePromptVersions(workspaceId, botId);
  const create = useCreatePromptVersion(workspaceId, botId);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [note, setNote] = useState('');

  if (versions.isPending) return <Skeleton className="h-32 w-full" />;
  const rows = versions.data ?? [];
  const active = rows[0];

  return (
    <div className="max-w-2xl space-y-6">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { systemPrompt, ...(note.trim() === '' ? {} : { note: note.trim() }) },
            {
              onSuccess: () => {
                setSystemPrompt('');
                setNote('');
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
            className="min-h-48 w-full rounded-md border p-2 font-mono text-sm"
            value={systemPrompt}
            disabled={!isAdmin}
            placeholder={active?.systemPrompt ?? ''}
            onChange={(event) => {
              setSystemPrompt(event.target.value);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bot-instructions-note">{strings.bots.note}</Label>
          <Input
            id="bot-instructions-note"
            value={note}
            maxLength={200}
            disabled={!isAdmin}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>

        <FormAlert message={errorMessage(create.error)} />

        <Button type="submit" disabled={!isAdmin || create.isPending}>
          {strings.bots.saveVersion}
        </Button>
      </form>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{strings.bots.instructions}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.bots.emptyInstructions}</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((version) => (
              <li key={version.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{strings.bots.version(version.version)}</span>
                  <time className="text-xs text-muted-foreground" dateTime={version.createdAt}>
                    {version.createdAt.slice(0, 10)}
                  </time>
                </div>
                {version.note === null ? null : (
                  <p className="text-xs text-muted-foreground">{version.note}</p>
                )}
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">
                  {version.systemPrompt === '' ? '—' : version.systemPrompt}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
