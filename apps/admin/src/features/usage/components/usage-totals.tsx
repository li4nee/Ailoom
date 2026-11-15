// SPDX-License-Identifier: AGPL-3.0-only
import { strings } from '@/strings';
import type { UsageReport } from '@app/shared';

import { escalationRate, positiveRate } from '../api';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function UsageTotals({ report }: { report: UsageReport }) {
  const positive = positiveRate(report);
  const cap = report.monthToDate;
  const spent = cap === null ? 0 : Number(cap.costUsd);
  const limit = cap === null ? 0 : Number(cap.capUsd);
  const percent = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={strings.usage.conversations} value={String(report.totals.conversations)} />
        <Tile label={strings.usage.visitorMessages} value={String(report.totals.visitorMessages)} />
        <Tile label={strings.usage.aiMessages} value={String(report.totals.aiMessages)} />
        <Tile
          label={strings.usage.escalationRate}
          value={escalationRate(report)}
          hint={strings.usage.escalationRateHint}
        />
        <Tile
          label={strings.usage.tokens}
          value={String(
            report.totals.inputTokens + report.totals.outputTokens + report.totals.embeddingTokens,
          )}
        />
        <Tile label={strings.usage.cost} value={`$${report.totals.costUsd}`} />
        <Tile label={strings.usage.positive} value={String(report.feedback.positive)} />
        <Tile
          label={strings.usage.positiveRate}
          value={positive ?? strings.conversations.trace.none}
        />
      </section>

      <section className="rounded-lg border p-3">
        <h2 className="text-sm font-medium">{strings.usage.monthToDate}</h2>
        {cap === null ? (
          <p className="text-sm text-muted-foreground">{strings.usage.noCap}</p>
        ) : (
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span>
                ${cap.costUsd} / ${cap.capUsd}
              </span>
              <span className="text-muted-foreground">{percent.toFixed(0)}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={strings.usage.monthToDate}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${String(percent)}%` }} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
