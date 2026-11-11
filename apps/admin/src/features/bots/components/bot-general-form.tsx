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

import { useBot, useUpdateBot } from '../api';

export function BotGeneralForm({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const update = useUpdateBot(workspaceId, botId);
  const [name, setName] = useState<string | null>(null);

  const data = bot.data;
  if (data === undefined) return <Skeleton className="h-24 w-full" />;
  const value = name ?? data.name;

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ name: value });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bot-name">{strings.bots.name}</Label>
        <Input
          id="bot-name"
          value={value}
          required
          maxLength={80}
          disabled={!isAdmin}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-public-key">{strings.bots.publicKey}</Label>
        <Input id="bot-public-key" value={data.publicKey} readOnly />
      </div>

      <FormAlert message={errorMessage(update.error)} />
      {isAdmin ? null : (
        <p className="text-sm text-muted-foreground">{strings.bots.agentsReadOnly}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!isAdmin || update.isPending}>
          {strings.bots.save}
        </Button>
        {update.isSuccess ? (
          <span className="text-sm text-muted-foreground">{strings.bots.saved}</span>
        ) : null}
      </div>
    </form>
  );
}
