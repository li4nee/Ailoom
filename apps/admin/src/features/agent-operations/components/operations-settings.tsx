// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, RoleGate, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMe } from '@/features/auth/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import {
  AGENT_PRESENCE_STATES,
  PRIORITIES,
  type AgentOperationsPolicy,
  type AgentOperationsPolicyUpdate,
  type AgentPresence,
  type AgentPresenceState,
  type Priority,
} from '@app/shared';

import {
  useHeartbeatAgentPresence,
  useAgentOperationsPolicy,
  useAgentPresence,
  useSetAgentPresence,
  useUpdateAgentOperationsPolicy,
} from '../api';

type BusinessDay = keyof AgentOperationsPolicy['sla']['businessHours'];
type DayDraft = Record<BusinessDay, { start: string; end: string }>;

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const satisfies readonly BusinessDay[];

function emptyDayDraft(): DayDraft {
  return Object.fromEntries(DAYS.map((day) => [day, { start: '', end: '' }])) as DayDraft;
}

function draftFromPolicy(policy: AgentOperationsPolicy): AgentOperationsPolicyUpdate {
  return {
    routing: {
      enabled: policy.routing.enabled,
      strategy: policy.routing.strategy,
      maxOpenConversationsPerAgent: policy.routing.maxOpenConversationsPerAgent,
      eligibleRoles: policy.routing.eligibleRoles,
    },
    sla: policy.sla,
  };
}

function daysFromPolicy(policy: AgentOperationsPolicy): DayDraft {
  const days = emptyDayDraft();
  for (const day of DAYS) {
    const [range] = policy.sla.businessHours[day];
    if (range !== undefined) days[day] = { start: range.start, end: range.end };
  }
  return days;
}

function policyWithHours(
  policy: AgentOperationsPolicyUpdate,
  dayDraft: DayDraft,
): AgentOperationsPolicyUpdate {
  const businessHours = Object.fromEntries(
    DAYS.map((day) => {
      const { start, end } = dayDraft[day];
      return [day, start === '' && end === '' ? [] : [{ start, end }]];
    }),
  ) as AgentOperationsPolicy['sla']['businessHours'];
  return { ...policy, sla: { ...policy.sla, businessHours } };
}

function currentPresence(presence: AgentPresence[] | undefined, userId: string | undefined) {
  return presence?.find((member) => member.userId === userId)?.state ?? 'offline';
}

export function OperationsSettings({ workspaceId }: { workspaceId: string }) {
  const canAdmin = hasRole(useWorkspaceRole(), 'admin');
  const me = useMe();
  const policyQuery = useAgentOperationsPolicy(workspaceId, canAdmin);
  const presenceQuery = useAgentPresence(workspaceId);
  const heartbeatPresence = useHeartbeatAgentPresence(workspaceId);
  const heartbeat = heartbeatPresence.mutate;
  const updatePresence = useSetAgentPresence(workspaceId);
  const copy = strings.agentOperations;
  const mine = currentPresence(presenceQuery.data, me.data?.id);

  useEffect(() => {
    if (mine === 'offline') return;
    const interval = window.setInterval(() => {
      heartbeat();
    }, 120_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [heartbeat, mine]);

  if (canAdmin && policyQuery.isPending) {
    return <p role="status">{copy.loading}</p>;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
      </header>

      <section aria-labelledby="presence-heading" className="ledger-panel space-y-4 p-5">
        <div>
          <h3 id="presence-heading" className="text-lg font-semibold">
            {copy.presence}
          </h3>
          <p className="text-sm text-muted-foreground">{copy.presenceHint}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="agent-presence">{copy.presence}</Label>
            <select
              id="agent-presence"
              className="h-10 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={mine}
              disabled={updatePresence.isPending || presenceQuery.isError}
              onChange={(event) => {
                updatePresence.mutate(event.target.value as AgentPresenceState);
              }}
            >
              {AGENT_PRESENCE_STATES.map((state) => (
                <option key={state} value={state}>
                  {copy.presenceStates[state]}
                </option>
              ))}
            </select>
          </div>
          {updatePresence.isSuccess ? <p role="status">{copy.saved}</p> : null}
          <FormAlert message={errorMessage(updatePresence.error)} />
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{copy.teamPresence}</h4>
          {presenceQuery.isError ? <FormAlert message={copy.presenceFailed} /> : null}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(presenceQuery.data ?? []).map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
              >
                <span className="truncate">{member.name ?? member.email}</span>
                <span className="shrink-0 text-muted-foreground">
                  {copy.presenceStates[member.state]}
                </span>
              </li>
            ))}
            {presenceQuery.data?.length === 0 ? (
              <li className="text-sm text-muted-foreground">{copy.noMembers}</li>
            ) : null}
          </ul>
        </div>
      </section>

      {canAdmin && policyQuery.data !== undefined ? (
        <OperationsPolicyForm
          workspaceId={workspaceId}
          policy={policyQuery.data}
          policyError={policyQuery.error}
        />
      ) : canAdmin ? (
        <FormAlert message={copy.loadFailed} />
      ) : (
        <section className="ledger-panel p-5">
          <p className="text-sm text-muted-foreground">{copy.readOnly}</p>
        </section>
      )}
    </div>
  );
}

function OperationsPolicyForm({
  workspaceId,
  policy,
  policyError,
}: {
  workspaceId: string;
  policy: AgentOperationsPolicy;
  policyError: unknown;
}) {
  const updatePolicy = useUpdateAgentOperationsPolicy(workspaceId);
  const [draft, setDraft] = useState(() => draftFromPolicy(policy));
  const [dayDraft, setDayDraft] = useState(() => daysFromPolicy(policy));
  const copy = strings.agentOperations;
  const hoursDraftInvalid = DAYS.some(
    (day) => (dayDraft[day].start === '') !== (dayDraft[day].end === ''),
  );
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (hoursDraftInvalid) return;
        updatePolicy.mutate(policyWithHours(draft, dayDraft));
      }}
    >
      <section aria-labelledby="routing-heading" className="ledger-panel space-y-4 p-5">
        <div>
          <h3 id="routing-heading" className="text-lg font-semibold">
            {copy.routing}
          </h3>
          <p className="text-sm text-muted-foreground">{copy.routingHint}</p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={draft.routing.enabled}
            onChange={(event) => {
              setDraft({
                ...draft,
                routing: { ...draft.routing, enabled: event.target.checked },
              });
            }}
          />
          <span>{copy.enableRouting}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="routing-strategy">{copy.strategy}</Label>
            <select
              id="routing-strategy"
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              value={draft.routing.strategy}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  routing: {
                    ...draft.routing,
                    strategy: event.target.value as 'round_robin' | 'least_loaded',
                  },
                });
              }}
            >
              {(['round_robin', 'least_loaded'] as const).map((strategy) => (
                <option key={strategy} value={strategy}>
                  {copy.strategies[strategy]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="routing-capacity">{copy.capacity}</Label>
            <Input
              id="routing-capacity"
              type="number"
              min={1}
              max={100}
              value={draft.routing.maxOpenConversationsPerAgent}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  routing: {
                    ...draft.routing,
                    maxOpenConversationsPerAgent: Number(event.target.value),
                  },
                });
              }}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="sla-heading" className="ledger-panel space-y-4 p-5">
        <div>
          <h3 id="sla-heading" className="text-lg font-semibold">
            {copy.sla}
          </h3>
          <p className="text-sm text-muted-foreground">{copy.slaHint}</p>
        </div>
        <div className="space-y-1 sm:max-w-sm">
          <Label htmlFor="sla-timezone">{copy.timezone}</Label>
          <Input
            id="sla-timezone"
            value={draft.sla.timeZone}
            maxLength={64}
            onChange={(event) => {
              setDraft({
                ...draft,
                sla: { ...draft.sla, timeZone: event.target.value },
              });
            }}
          />
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{copy.businessHours}</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {DAYS.map((day) => (
              <div key={day} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2">
                <Label htmlFor={`hours-${day}-start`} className="text-sm">
                  {copy.days[day]}
                </Label>
                <Input
                  id={`hours-${day}-start`}
                  type="time"
                  aria-label={`${copy.days[day]} ${copy.start}`}
                  value={dayDraft[day].start}
                  onChange={(event) => {
                    setDayDraft({
                      ...dayDraft,
                      [day]: { ...dayDraft[day], start: event.target.value },
                    });
                  }}
                />
                <Input
                  id={`hours-${day}-end`}
                  type="time"
                  aria-label={`${copy.days[day]} ${copy.end}`}
                  value={dayDraft[day].end}
                  onChange={(event) => {
                    setDayDraft({
                      ...dayDraft,
                      [day]: { ...dayDraft[day], end: event.target.value },
                    });
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{copy.allDay}</p>
        </div>
        <div className="space-y-3">
          <div className="hidden grid-cols-[minmax(6rem,1fr)_1fr_1fr] gap-3 text-xs text-muted-foreground sm:grid">
            <span />
            <span>{copy.firstResponseMinutes}</span>
            <span>{copy.resolutionMinutes}</span>
          </div>
          {PRIORITIES.map((priority) => (
            <div
              key={priority}
              className="grid gap-2 rounded-md border border-border/70 p-3 sm:grid-cols-[minmax(6rem,1fr)_1fr_1fr] sm:items-center"
            >
              <span className="text-sm font-medium">{copy.priorities[priority]}</span>
              <TargetInput
                id={`sla-response-${priority}`}
                label={copy.firstResponseMinutes}
                value={draft.sla.targets[priority].firstResponseMinutes}
                onChange={(value) => {
                  updateTarget(draft, setDraft, priority, 'firstResponseMinutes', value);
                }}
              />
              <TargetInput
                id={`sla-resolution-${priority}`}
                label={copy.resolutionMinutes}
                value={draft.sla.targets[priority].resolutionMinutes}
                onChange={(value) => {
                  updateTarget(draft, setDraft, priority, 'resolutionMinutes', value);
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <FormAlert
        message={
          hoursDraftInvalid
            ? `${copy.start} and ${copy.end} must both be set for each configured day.`
            : (errorMessage(policyError) ?? errorMessage(updatePolicy.error))
        }
      />
      {updatePolicy.isSuccess ? <p role="status">{copy.saved}</p> : null}
      <RoleGate min="admin">
        <Button type="submit" disabled={updatePolicy.isPending || hoursDraftInvalid}>
          {copy.save}
        </Button>
      </RoleGate>
    </form>
  );
}

function updateTarget(
  policy: AgentOperationsPolicyUpdate,
  setPolicy: (policy: AgentOperationsPolicyUpdate) => void,
  priority: Priority,
  field: 'firstResponseMinutes' | 'resolutionMinutes',
  value: number | null,
) {
  setPolicy({
    ...policy,
    sla: {
      ...policy.sla,
      targets: {
        ...policy.sla.targets,
        [priority]: { ...policy.sla.targets[priority], [field]: value },
      },
    },
  });
}

function TargetInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground sm:sr-only">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={1}
        max={43_200}
        placeholder={strings.agentOperations.disabledTarget}
        value={value ?? ''}
        onChange={(event) => {
          onChange(event.target.value === '' ? null : Number(event.target.value));
        }}
      />
    </div>
  );
}
