// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { TraceDetail } from '@app/shared';

import { useTrace } from '../api';

function valueOrDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ''
    ? strings.conversations.trace.none
    : String(value);
}

function Details({ trace }: { trace: TraceDetail }) {
  const [copied, setCopied] = useState(false);
  const rows = [
    [strings.conversations.trace.decision, trace.decision],
    [strings.conversations.trace.reason, valueOrDash(trace.decisionReason)],
    [
      strings.conversations.trace.prompt,
      trace.promptVersion === null
        ? strings.conversations.trace.platformPrompt
        : `v${String(trace.promptVersion.version)}`,
    ],
    [
      strings.conversations.trace.chat,
      trace.chat === null
        ? strings.conversations.trace.none
        : `${trace.chat.provider}/${trace.chat.model}`,
    ],
    [
      strings.conversations.trace.embedding,
      trace.embedding === null
        ? strings.conversations.trace.none
        : `${trace.embedding.provider}/${trace.embedding.model}`,
    ],
    [
      strings.conversations.trace.tokens,
      `${String(trace.inputTokens)} / ${String(trace.outputTokens)} / ${String(trace.embeddingTokens)}`,
    ],
    [
      strings.conversations.trace.cost,
      trace.priceKnown ? `$${trace.costUsd}` : strings.conversations.trace.priceUnknown,
    ],
    [strings.conversations.trace.latency, valueOrDash(trace.latencyMs)],
    [strings.conversations.trace.ttft, valueOrDash(trace.ttftMs)],
    [strings.conversations.trace.feedback, valueOrDash(trace.feedback)],
  ] as const;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {trace.error === null ? null : <FormAlert message={trace.error} />}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{strings.conversations.trace.retrieval}</h3>
        {trace.retrieval.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.conversations.trace.none}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.conversations.trace.rank}</TableHead>
                <TableHead>{strings.conversations.trace.score}</TableHead>
                <TableHead>{strings.conversations.trace.used}</TableHead>
                <TableHead>{strings.conversations.trace.source}</TableHead>
                <TableHead>{strings.conversations.trace.preview}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trace.retrieval.map((row) => (
                <TableRow key={row.chunkId}>
                  <TableCell className="tabular-nums">{row.rank}</TableCell>
                  <TableCell className="tabular-nums">{row.score.toFixed(3)}</TableCell>
                  <TableCell>{row.used ? '✓' : '—'}</TableCell>
                  <TableCell>
                    {row.sourceDeleted ? (
                      <span className="text-muted-foreground">
                        {strings.conversations.trace.deleted}
                      </span>
                    ) : (
                      (row.sourceTitle ?? row.documentId ?? strings.conversations.trace.none)
                    )}
                  </TableCell>
                  <TableCell className="max-w-80 truncate whitespace-normal text-muted-foreground">
                    {row.preview ?? strings.conversations.trace.none}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <details className="space-y-2">
        <summary className="cursor-pointer text-sm font-medium">
          {strings.conversations.trace.snapshot}
        </summary>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(trace.requestSnapshot, null, 2))
              .then(() => {
                setCopied(true);
              });
          }}
        >
          {copied ? strings.conversations.trace.copied : strings.conversations.trace.copy}
        </Button>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(trace.requestSnapshot, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** The replay drawer behind an AI message (spec §17.8). */
export function TraceDrawer({ workspaceId, traceId }: { workspaceId: string; traceId: string }) {
  const [open, setOpen] = useState(false);
  const trace = useTrace(workspaceId, traceId, open);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <>
      <Button
        variant="link"
        size="xs"
        className="px-0"
        onClick={() => {
          setOpen(true);
        }}
      >
        {strings.conversations.trace.title}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label={strings.conversations.detail.close}
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setOpen(false);
            }}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={strings.conversations.trace.title}
            className="relative h-full w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-lg"
          >
            <header className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{strings.conversations.trace.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {trace.data === undefined
                    ? traceId
                    : new Date(trace.data.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {strings.conversations.detail.close}
              </Button>
            </header>
            <FormAlert message={errorMessage(trace.error)} />
            {trace.isLoading ? <p role="status">{strings.app.loading}</p> : null}
            {trace.data === undefined ? null : <Details trace={trace.data} />}
          </section>
        </div>
      ) : null}
    </>
  );
}
