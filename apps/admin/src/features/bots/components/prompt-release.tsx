// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-error';
import { errorMessage } from '@/lib/error-message';
import type { PromptVersionDto } from '@app/shared';

import { useActivatePromptVersion, usePromptReleaseStatus } from '../api';

export function PromptRelease({
  workspaceId,
  botId,
  version,
  active,
  onRelease,
}: {
  workspaceId: string;
  botId: string;
  version: PromptVersionDto;
  active: PromptVersionDto | undefined;
  onRelease: (message: string) => void;
}) {
  const isOwner = useWorkspaceRole() === 'owner';
  const isLive = version.id === active?.id;
  const status = usePromptReleaseStatus(workspaceId, botId, isLive ? '' : version.id);
  const activate = useActivatePromptVersion(workspaceId, botId);
  const [open, setOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [expectedActiveVersionId, setExpectedActiveVersionId] = useState<string | null>(null);

  const liveVersionId = active?.id ?? null;
  const gate = status.data?.gate;
  const blocked = Boolean(gate?.blockedReason);
  const stale = status.data !== undefined && status.data.activeVersionId !== liveVersionId;
  const dialogStale = stale || expectedActiveVersionId !== liveVersionId;
  const rollback = status.data?.operation === 'rollback';
  const action = rollback ? 'Restore version' : 'Publish version';
  const evaluate = `/w/${workspaceId}/bots/${botId}/evaluate`;
  const evalQuery = new URLSearchParams({ promptVersionId: version.id });
  if (gate) evalQuery.set('datasetId', gate.datasetId);
  const gateError =
    activate.error instanceof ApiError
      ? activate.error.details.find(({ path }) => path === 'evalGate' || path === 'activeVersionId')
          ?.message
      : undefined;

  if (isLive) return null;

  return (
    <div className="space-y-3 border-t pt-3">
      {status.isPending ? (
        <p className="text-sm text-muted-foreground">Checking release requirements…</p>
      ) : null}
      {status.isError ? (
        <FormAlert message={errorMessage(status.error)} />
      ) : gate?.blockedReason ? (
        <p className="text-sm text-muted-foreground">{gate.blockedReason}</p>
      ) : gate ? (
        <p className="text-sm">Evaluation gate passed.</p>
      ) : null}
      {gate && gate.passRate !== null ? (
        <p className="text-sm text-muted-foreground">
          {Math.round(gate.passRate * 100)}% pass rate
          {gate.baselinePassRate === null
            ? ''
            : ` · ${String(Math.round(gate.baselinePassRate * 100))}% baseline`}
        </p>
      ) : null}
      {stale ? (
        <FormAlert message="The live prompt changed. Refresh this page to review the current version." />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={`${evaluate}?${evalQuery}`}>Evaluate version</a>
        </Button>
        {gate?.runId ? (
          <Button asChild variant="ghost" size="sm">
            <a
              href={`${evaluate}?${new URLSearchParams({ datasetId: gate.datasetId, runId: gate.runId, promptVersionId: version.id })}`}
            >
              View gate run
            </a>
          </Button>
        ) : null}
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (activate.isPending) return;
            if (next) {
              setOverrideReason('');
              setExpectedActiveVersionId(liveVersionId);
              activate.reset();
            }
            setOpen(next);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" disabled={!status.isSuccess || stale || (blocked && !isOwner)}>
              {action}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {rollback
                  ? `Restore version ${String(version.version)}?`
                  : `Publish version ${String(version.version)}?`}
              </DialogTitle>
              <DialogDescription>
                The bot will use this version for new answers.
                {active ? ` It will replace live version ${String(active.version)}.` : ''}
              </DialogDescription>
            </DialogHeader>
            {blocked && isOwner && gate ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{gate.blockedReason}</p>
                <Label htmlFor="prompt-override-reason">
                  Reason for overriding the evaluation gate
                </Label>
                <textarea
                  id="prompt-override-reason"
                  className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
                  maxLength={500}
                  value={overrideReason}
                  onChange={(event) => {
                    setOverrideReason(event.target.value);
                  }}
                />
              </div>
            ) : null}
            <FormAlert
              message={
                dialogStale
                  ? 'The live prompt changed. Close this dialog and review the current version.'
                  : (gateError ?? errorMessage(activate.error))
              }
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={activate.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={
                  activate.isPending ||
                  !status.isSuccess ||
                  dialogStale ||
                  (blocked && (!isOwner || !overrideReason.trim()))
                }
                onClick={() => {
                  activate.mutate(
                    {
                      versionId: version.id,
                      expectedActiveVersionId,
                      ...(blocked ? { overrideReason: overrideReason.trim() } : {}),
                    },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        onRelease(`Version ${String(version.version)} is live.`);
                      },
                      onError: () => {
                        void status.refetch();
                      },
                    },
                  );
                }}
              >
                {blocked ? 'Override and continue' : action}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
