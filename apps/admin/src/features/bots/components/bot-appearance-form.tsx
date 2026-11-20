// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { type Appearance, contrastText } from '@app/shared';

import { useBot, useUpdateBot } from '../api';

export function BotAppearanceForm({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const update = useUpdateBot(workspaceId, botId);
  const [draft, setDraft] = useState<Partial<Appearance>>({});

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  const data = bot.data;
  if (data === undefined) return <Skeleton className="h-24 w-full" />;

  const appearance: Appearance = { ...data.appearance, ...draft };
  const labelColor = contrastText(appearance.themeColor);

  function set<K extends keyof Appearance>(key: K, value: Appearance[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ appearance: draft });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bot-display-name">{strings.bots.displayName}</Label>
        <Input
          id="bot-display-name"
          value={appearance.displayName}
          maxLength={60}
          disabled={!isAdmin}
          onChange={(event) => {
            set('displayName', event.target.value);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-theme-color">{strings.bots.themeColor}</Label>
        <Input
          id="bot-theme-color"
          type="color"
          value={appearance.themeColor}
          disabled={!isAdmin}
          onChange={(event) => {
            set('themeColor', event.target.value.toLowerCase());
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-position">{strings.bots.position}</Label>
        <NativeSelect
          id="bot-position"
          value={appearance.position}
          disabled={!isAdmin}
          onChange={(event) => {
            set('position', event.target.value === 'left' ? 'left' : 'right');
          }}
        >
          <option value="right">{strings.bots.positions.right}</option>
          <option value="left">{strings.bots.positions.left}</option>
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-welcome">{strings.bots.welcomeMessage}</Label>
        <Input
          id="bot-welcome"
          value={appearance.welcomeMessage}
          maxLength={500}
          disabled={!isAdmin}
          onChange={(event) => {
            set('welcomeMessage', event.target.value);
          }}
        />
      </div>

      <section aria-label={strings.bots.preview} className="space-y-2">
        <h3 className="ledger-heading text-sm">{strings.bots.preview}</h3>
        <div className="w-full max-w-[400px] overflow-hidden rounded-[14px] border bg-muted shadow-sm">
          <header
            className="flex min-h-14 items-center gap-2 px-3 text-sm font-semibold"
            style={{ backgroundColor: appearance.themeColor, color: labelColor }}
          >
            <h4 className="min-w-0 flex-1 break-words font-semibold">{appearance.displayName}</h4>
            <button
              type="button"
              disabled
              aria-label={strings.bots.closePreview}
              className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-current/20 px-2 text-xs"
            >
              {strings.bots.closePreview}
            </button>
          </header>
          <div className="flex min-h-64 flex-col bg-muted">
            <div className="flex-1 p-4">
              <p className="max-w-[88%] break-words rounded-xl rounded-bl-sm border bg-card px-3 py-2 text-sm leading-relaxed text-card-foreground">
                {appearance.welcomeMessage}
              </p>
            </div>
            <div className="flex items-end gap-2 border-t border-border bg-card p-3">
              <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-md border px-3 py-2 text-sm text-muted-foreground">
                {strings.bots.messagePlaceholder}
              </div>
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 shrink-0 items-center rounded-md px-4 text-sm font-medium"
                style={{ backgroundColor: appearance.themeColor, color: labelColor }}
              >
                {strings.bots.sendPreview}
              </button>
            </div>
          </div>
        </div>
      </section>

      <FormAlert message={errorMessage(update.error)} />

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
