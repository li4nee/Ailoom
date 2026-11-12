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
import { NO_ANSWER_BEHAVIORS, type NoAnswerBehavior } from '@app/shared';

import { useBot, useUpdateBot } from '../api';
import { normalizeOrigins } from '../origin';

export function BotBehaviorForm({ workspaceId, botId }: { workspaceId: string; botId: string }) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const update = useUpdateBot(workspaceId, botId);

  const [origins, setOrigins] = useState<string | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);
  const [noAnswer, setNoAnswer] = useState<NoAnswerBehavior | null>(null);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const [handoffEnabled, setHandoffEnabled] = useState<boolean | null>(null);
  const [temperature, setTemperature] = useState<string | null>(null);
  const [maxOutputTokens, setMaxOutputTokens] = useState<string | null>(null);

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  const data = bot.data;
  if (data === undefined) return <Skeleton className="h-24 w-full" />;

  const originLines = origins ?? data.allowedOrigins.join('\n');

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const normalized = normalizeOrigins(originLines.split('\n'));
        if ('error' in normalized) {
          setOriginError(normalized.error);
          return;
        }
        setOriginError(null);
        update.mutate({
          allowedOrigins: normalized.values,
          noAnswerBehavior: noAnswer ?? data.noAnswerBehavior,
          fallbackMessage: fallbackMessage ?? data.fallbackMessage,
          handoffMessage: handoffMessage ?? data.handoffMessage,
          handoffEnabled: handoffEnabled ?? data.handoffEnabled,
          temperature: Number(temperature ?? data.temperature),
          maxOutputTokens: Number(maxOutputTokens ?? data.maxOutputTokens),
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="bot-origins">{strings.bots.origins}</Label>
        <textarea
          id="bot-origins"
          className="min-h-24 w-full rounded-md border p-2 text-sm"
          value={originLines}
          disabled={!isAdmin}
          onChange={(event) => {
            setOrigins(event.target.value);
          }}
        />
        <p className="text-xs text-muted-foreground">{strings.bots.originsHint}</p>
        {originError === null ? null : <p className="text-sm text-destructive">{originError}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-no-answer">{strings.bots.noAnswer}</Label>
        <NativeSelect
          id="bot-no-answer"
          value={noAnswer ?? data.noAnswerBehavior}
          disabled={!isAdmin}
          onChange={(event) => {
            const value = event.target.value;
            if ((NO_ANSWER_BEHAVIORS as readonly string[]).includes(value)) {
              setNoAnswer(value as NoAnswerBehavior);
            }
          }}
        >
          {NO_ANSWER_BEHAVIORS.map((behavior) => (
            <option key={behavior} value={behavior}>
              {strings.bots.noAnswerBehaviors[behavior]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-fallback">{strings.bots.fallbackMessage}</Label>
        <Input
          id="bot-fallback"
          value={fallbackMessage ?? data.fallbackMessage}
          maxLength={1000}
          disabled={!isAdmin}
          onChange={(event) => {
            setFallbackMessage(event.target.value);
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bot-handoff">{strings.bots.handoffMessage}</Label>
        <Input
          id="bot-handoff"
          value={handoffMessage ?? data.handoffMessage}
          maxLength={1000}
          disabled={!isAdmin}
          onChange={(event) => {
            setHandoffMessage(event.target.value);
          }}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={handoffEnabled ?? data.handoffEnabled}
          disabled={!isAdmin}
          onChange={(event) => {
            setHandoffEnabled(event.target.checked);
          }}
        />
        {strings.bots.handoffEnabled}
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="bot-temperature">{strings.bots.temperature}</Label>
          <Input
            id="bot-temperature"
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={temperature ?? String(data.temperature)}
            disabled={!isAdmin}
            onChange={(event) => {
              setTemperature(event.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bot-max-tokens">{strings.bots.maxOutputTokens}</Label>
          <Input
            id="bot-max-tokens"
            type="number"
            min="64"
            max="4000"
            value={maxOutputTokens ?? String(data.maxOutputTokens)}
            disabled={!isAdmin}
            onChange={(event) => {
              setMaxOutputTokens(event.target.value);
            }}
          />
        </div>
      </div>

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
