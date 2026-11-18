// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';

import {
  useArchiveSavedReply,
  useCreateSavedReply,
  useReorderSavedReplies,
  useSavedReplies,
  useUpdateSavedReply,
} from './api';

export function SavedRepliesPanel({ workspaceId }: { workspaceId: string }) {
  const role = useWorkspaceRole();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const replies = useSavedReplies(workspaceId, { includeArchived });
  const create = useCreateSavedReply(workspaceId);
  const update = useUpdateSavedReply(workspaceId);
  const archive = useArchiveSavedReply(workspaceId);
  const reorder = useReorderSavedReplies(workspaceId);
  const isAdmin = hasRole(role, 'admin');
  const mutationError = [create.error, update.error, archive.error, reorder.error].find(
    (error) => error !== null,
  );

  if (!isAdmin) return <p role="status">{strings.savedReplies.adminOnly}</p>;

  const reset = (): void => {
    setEditingId(null);
    setTitle('');
    setBody('');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{strings.savedReplies.title}</h2>
        <p className="text-sm text-muted-foreground">{strings.savedReplies.intro}</p>
      </div>
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() === '' || body.trim() === '') return;
          if (editingId === null) {
            create.mutate({ title, body }, { onSuccess: reset });
          } else {
            update.mutate({ id: editingId, title, body }, { onSuccess: reset });
          }
        }}
      >
        <Label htmlFor="saved-reply-title">{strings.savedReplies.replyTitle}</Label>
        <Input
          id="saved-reply-title"
          maxLength={100}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <Label htmlFor="saved-reply-body">{strings.savedReplies.body}</Label>
        <textarea
          id="saved-reply-body"
          maxLength={4_000}
          rows={5}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <Button
            disabled={
              create.isPending || update.isPending || title.trim() === '' || body.trim() === ''
            }
          >
            {editingId === null ? strings.savedReplies.create : strings.savedReplies.save}
          </Button>
          {editingId === null ? null : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
              }}
            >
              {strings.savedReplies.cancel}
            </Button>
          )}
        </div>
      </form>
      <FormAlert message={errorMessage(mutationError)} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => {
            setIncludeArchived(event.target.checked);
          }}
        />
        {strings.savedReplies.showArchived}
      </label>
      <ol className="space-y-3">
        {(replies.data ?? []).map((reply) => {
          const activeIds = (replies.data ?? [])
            .filter((item) => item.archivedAt === null)
            .map((item) => item.id);
          const activeIndex = activeIds.indexOf(reply.id);
          return (
            <li
              key={reply.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">
                  {reply.title}
                  {reply.archivedAt === null ? '' : ` · ${strings.savedReplies.archived}`}
                </h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{reply.body}</p>
              </div>
              {reply.archivedAt !== null ? null : (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={activeIndex === 0 || reorder.isPending}
                    onClick={() => {
                      const ids = [...activeIds];
                      [ids[activeIndex - 1], ids[activeIndex]] = [
                        ids[activeIndex] ?? '',
                        ids[activeIndex - 1] ?? '',
                      ];
                      reorder.mutate(ids);
                    }}
                  >
                    {strings.savedReplies.moveUp}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(reply.id);
                      setTitle(reply.title);
                      setBody(reply.body);
                    }}
                  >
                    {strings.savedReplies.edit}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={archive.isPending}
                    onClick={() => {
                      archive.mutate(reply.id);
                    }}
                  >
                    {strings.savedReplies.archive}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
