// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { strings } from '@/strings';
import type { ConversationDetail } from '@app/shared';

const SENSITIVE_KEY = /secret|token|password|auth|phone|address|birth|ssn|credit|card/i;

export function ContactSidebar({
  workspaceId,
  contact,
  history,
}: {
  workspaceId: string;
  contact: ConversationDetail['contact'];
  history: ConversationDetail['contactHistory'];
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <aside
      className="space-y-4 rounded-lg border p-4"
      aria-label={strings.conversations.contactContext}
    >
      <h2 className="font-semibold">{strings.conversations.contactContext}</h2>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{strings.conversations.email}</dt>
          <dd className="flex items-center gap-2 break-all">
            {contact.email ?? strings.conversations.unknown}
            {contact.email === null ? null : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(contact.email ?? '')}
              >
                {strings.conversations.copy}
              </Button>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{strings.conversations.externalId}</dt>
          <dd className="flex items-center gap-2 break-all">
            {contact.externalId ?? strings.conversations.unknown}
            {contact.externalId === null ? null : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(contact.externalId ?? '')}
              >
                {strings.conversations.copy}
              </Button>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{strings.conversations.firstSeen}</dt>
          <dd>{new Date(contact.firstSeenAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{strings.conversations.lastSeen}</dt>
          <dd>{new Date(contact.lastSeenAt).toLocaleString()}</dd>
        </div>
      </dl>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{strings.conversations.attributes}</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setRevealed((value) => !value);
            }}
          >
            {revealed ? strings.conversations.maskSensitive : strings.conversations.revealSensitive}
          </Button>
        </div>
        {Object.keys(contact.attributes).length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.conversations.noAttributes}</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {Object.entries(contact.attributes).map(([key, value]) => (
              <div key={key} className="break-words">
                <dt className="text-muted-foreground">{key}</dt>
                <dd>
                  {SENSITIVE_KEY.test(key) && !revealed
                    ? '••••••••'
                    : typeof value === 'string'
                      ? value
                      : JSON.stringify(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">{strings.conversations.history}</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.conversations.noHistory}</p>
        ) : (
          <ul className="space-y-3">
            {history.map((item) => (
              <li key={item.id} className="text-sm">
                <Link
                  className="font-medium underline underline-offset-2"
                  to="/w/$workspaceId/conversations/$conversationId"
                  params={{ workspaceId, conversationId: item.id }}
                >
                  {item.botName} · {strings.conversations.statuses[item.status]}
                </Link>
                <p className="text-muted-foreground">{item.lastMessagePreview}</p>
                <time dateTime={item.lastMessageAt} className="text-xs text-muted-foreground">
                  {new Date(item.lastMessageAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
