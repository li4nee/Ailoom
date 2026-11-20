// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import { useBot, useRotateKey } from '../api';
import { buildEmbedSnippet } from '../embed-snippet';

export function BotInstall({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const rotate = useRotateKey(workspaceId, botId);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  const data = bot.data;
  if (data === undefined) return <Skeleton className="h-32 w-full" />;

  const snippet = buildEmbedSnippet(window.location.origin, data.publicKey);
  const copySnippet = async (): Promise<void> => {
    // Clipboard access is unavailable outside secure contexts and may be refused by the browser.
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    setCopied(false);
    setCopyFailed(false);
    try {
      if (clipboard === undefined) throw new Error('Clipboard unavailable');
      await clipboard.writeText(snippet);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {data.allowedOrigins.length === 0 ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {strings.bots.widgetDisabled}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">{strings.bots.installIntro}</p>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{strings.bots.snippet}</h3>
        <pre className="max-w-full break-all whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs">
          {snippet}
        </pre>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void copySnippet();
            }}
          >
            {strings.bots.copy}
          </Button>
          {copied ? (
            <span role="status" className="text-sm">
              {strings.bots.copied}
            </span>
          ) : null}
        </div>
        {copyFailed ? (
          <p role="status" className="text-sm text-muted-foreground">
            {strings.bots.copyFailed}
          </p>
        ) : null}
      </div>

      {isAdmin ? (
        <div className="space-y-2">
          <ConfirmDialog
            trigger={
              <Button variant="destructive" size="sm">
                {strings.bots.rotate}
              </Button>
            }
            title={strings.bots.rotateConfirm}
            description={strings.bots.rotateIntro}
            confirmLabel={strings.bots.rotate}
            error={errorMessage(rotate.error)}
            pending={rotate.isPending}
            onConfirm={(close) => {
              rotate.mutate(undefined, { onSuccess: close });
            }}
          />
          <FormAlert message={rotate.isSuccess ? null : errorMessage(rotate.error)} />
        </div>
      ) : null}
    </div>
  );
}
