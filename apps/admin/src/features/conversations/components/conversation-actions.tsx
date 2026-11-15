// SPDX-License-Identifier: AGPL-3.0-only
import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { ConversationDetail } from '@app/shared';

import { useClose, useHandback, useTakeover } from '../api';

export function ConversationActions({
  workspaceId,
  conversationId,
  conversation,
}: {
  workspaceId: string;
  conversationId: string;
  conversation: ConversationDetail['conversation'];
}) {
  const takeover = useTakeover(workspaceId, conversationId);
  const handback = useHandback(workspaceId, conversationId);
  const close = useClose(workspaceId, conversationId);
  const error = [takeover.error, handback.error, close.error].find(
    (candidate) => candidate !== null,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {conversation.status === 'ai' || conversation.status === 'needs_human' ? (
          <Button
            size="sm"
            disabled={takeover.isPending}
            onClick={() => {
              takeover.mutate();
            }}
          >
            {strings.conversations.detail.takeover}
          </Button>
        ) : null}
        {conversation.status === 'human' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={handback.isPending}
            onClick={() => {
              handback.mutate();
            }}
          >
            {strings.conversations.detail.handback}
          </Button>
        ) : null}
        {conversation.status === 'closed' ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => {
              close.mutate();
            }}
          >
            {strings.conversations.detail.close}
          </Button>
        )}
      </div>
      <FormAlert message={errorMessage(error)} />
    </div>
  );
}
