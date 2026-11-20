// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/api';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import type { InternalNote } from '@app/shared';

import {
  useCreateInternalNote,
  useDeleteInternalNote,
  useInternalNotes,
  useUpdateInternalNote,
} from '../api';

export function InternalNotes({
  workspaceId,
  conversationId,
  role,
}: {
  workspaceId: string;
  conversationId: string;
  role: string | null;
}) {
  const notes = useInternalNotes(workspaceId, conversationId);
  const me = useMe();
  const create = useCreateInternalNote(workspaceId, conversationId);
  const update = useUpdateInternalNote(workspaceId, conversationId);
  const remove = useDeleteInternalNote(workspaceId, conversationId);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');
  const canModerate = role === 'owner' || role === 'admin';

  const save = (note: InternalNote): void => {
    update.mutate(
      { noteId: note.id, body: editBody, expectedVersion: editVersion ?? note.version },
      {
        onSuccess: () => {
          setEditing(null);
          setEditVersion(null);
        },
      },
    );
  };

  return (
    <section className="internal-notes mt-4 space-y-3 p-4">
      <header>
        <h2 className="font-medium">{strings.conversations.detail.internalNotes}</h2>
        <p className="text-xs text-muted-foreground">
          {strings.conversations.detail.internalNotesWarning}
        </p>
      </header>
      {notes.isLoading ? <p role="status">{strings.app.loading}</p> : null}
      {notes.error ? <FormAlert message={errorMessage(notes.error)} /> : null}
      {notes.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {strings.conversations.detail.noInternalNotes}
        </p>
      ) : null}
      <ol className="space-y-3" aria-label={strings.conversations.detail.internalNotes}>
        {notes.data?.map((note) => {
          const canEdit = canModerate || note.author?.id === me.data?.id;
          return (
            <li key={note.id} className="note-item rounded-md border p-3">
              <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium">
                  {note.author?.name ?? strings.conversations.detail.deletedNoteAuthor}
                </span>
                <time dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleString()}</time>
              </header>
              {note.deletedAt !== null ? (
                <p className="text-sm italic text-muted-foreground">
                  {strings.conversations.detail.noteDeleted(note.deletedBy?.name ?? null)}
                </p>
              ) : editing === note.id ? (
                <div className="space-y-2">
                  <label className="sr-only" htmlFor={`note-edit-${note.id}`}>
                    {strings.conversations.detail.editNote}
                  </label>
                  <textarea
                    id={`note-edit-${note.id}`}
                    value={editBody}
                    maxLength={4000}
                    rows={3}
                    className="w-full rounded-md border bg-transparent p-2 text-sm"
                    onChange={(event) => {
                      setEditBody(event.target.value);
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={update.isPending || editBody.trim() === ''}
                      onClick={() => {
                        save(note);
                      }}
                    >
                      {strings.conversations.detail.saveNote}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditing(null);
                        setEditVersion(null);
                      }}
                    >
                      {strings.conversations.detail.cancelNote}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm">{note.body}</p>
                  {canEdit ? (
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditing(note.id);
                          setEditVersion(note.version);
                          setEditBody(note.body ?? '');
                        }}
                      >
                        {strings.conversations.detail.editNote}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (!window.confirm(strings.conversations.detail.confirmDeleteNote))
                            return;
                          remove.mutate({ noteId: note.id, expectedVersion: note.version });
                        }}
                      >
                        {strings.conversations.detail.deleteNote}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = body.trim();
          if (next === '' || create.isPending) return;
          create.mutate(
            { body: next },
            {
              onSuccess: () => {
                setBody('');
              },
            },
          );
        }}
      >
        <label className="sr-only" htmlFor="internal-note-body">
          {strings.conversations.detail.internalNoteComposer}
        </label>
        <textarea
          id="internal-note-body"
          value={body}
          maxLength={4000}
          rows={3}
          placeholder={strings.conversations.detail.internalNotePlaceholder}
          className="w-full rounded-md border bg-transparent p-2 text-sm"
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <Button type="submit" disabled={create.isPending || body.trim() === ''}>
          {create.isPending
            ? strings.conversations.detail.savingNote
            : strings.conversations.detail.addInternalNote}
        </Button>
        <FormAlert
          message={
            errorMessage(create.error) ?? errorMessage(update.error) ?? errorMessage(remove.error)
          }
        />
      </form>
    </section>
  );
}
