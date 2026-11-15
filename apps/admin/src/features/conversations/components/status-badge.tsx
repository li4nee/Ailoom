// SPDX-License-Identifier: AGPL-3.0-only
import { Badge } from '@/components/ui/badge';
import { strings } from '@/strings';
import type { ConversationStatus } from '@app/shared';

const VARIANT: Record<ConversationStatus, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  ai: 'secondary',
  needs_human: 'destructive',
  human: 'default',
  closed: 'outline',
};

export function StatusBadge({ status }: { status: ConversationStatus }) {
  return <Badge variant={VARIANT[status]}>{strings.conversations.statuses[status]}</Badge>;
}
