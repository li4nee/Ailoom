// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';
import type { TraceDecision } from '@app/shared';

import type { PlaygroundTrace } from '../api';

const decisionLabels: Record<TraceDecision, string> = {
  answered: strings.playground.trace.decisions.answered,
  escalated: strings.playground.trace.decisions.escalated,
  refused: strings.playground.trace.decisions.refused,
  error: strings.playground.trace.decisions.error,
};

export function reasonLabel(reason: string): string {
  const reasons: Record<string, string> = strings.playground.trace.reasons;
  return reasons[reason] ?? reason;
}

/** Spec §18.2: the playground shows the decision, cost and latency behind one answer. */
export function TraceSummary({
  trace,
  workspaceId,
  botId,
}: {
  trace: PlaygroundTrace;
  workspaceId: string;
  botId: string;
}) {
  const rows = [
    [strings.playground.trace.decision, decisionLabels[trace.decision]],
    [strings.playground.trace.topScore, trace.topScore === null ? '—' : trace.topScore.toFixed(3)],
    [
      strings.playground.trace.tokens,
      `${String(trace.inputTokens)} / ${String(trace.outputTokens)}`,
    ],
    [strings.playground.trace.cost, `$${trace.costUsd}`],
    [strings.playground.trace.latency, `${String(trace.latencyMs)} ms`],
  ] as const;

  return (
    <section
      aria-label={strings.playground.trace.title}
      className="rounded-md border bg-muted/40 p-3 text-xs"
    >
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-1">
            <dt className="text-muted-foreground">{label}:</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <a
        className="mt-2 inline-block underline underline-offset-2"
        href={`/w/${workspaceId}/bots/${botId}/traces/${trace.traceId}`}
      >
        {strings.playground.trace.openDetails}
      </a>
    </section>
  );
}
