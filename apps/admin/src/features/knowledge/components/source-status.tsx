// SPDX-License-Identifier: AGPL-3.0-only
import { Badge } from '@/components/ui/badge';
import { strings } from '@/strings';
import type { SourceDto, SourceStatus as Status } from '@app/shared';

/** One label per status; the badge colour says whether it needs attention. */
const LABELS: Record<Status, string> = {
  pending: strings.knowledge.statuses.pending,
  processing: strings.knowledge.statuses.processing,
  ready: strings.knowledge.statuses.ready,
  failed: strings.knowledge.statuses.failed,
  deleting: strings.knowledge.statuses.deleting,
};

const VARIANTS: Record<Status, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  processing: 'secondary',
  ready: 'default',
  failed: 'destructive',
  deleting: 'outline',
};

export function SourceStatus({
  status,
  pagesDone,
  pagesTotal,
}: Pick<SourceDto, 'status' | 'pagesDone' | 'pagesTotal'>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>
      {pagesTotal > 0 && status !== 'ready' ? (
        <span className="text-xs text-muted-foreground">
          {strings.knowledge.progress(pagesDone, pagesTotal)}
        </span>
      ) : null}
    </div>
  );
}
