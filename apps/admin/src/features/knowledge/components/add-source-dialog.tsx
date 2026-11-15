// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { TEXT_SOURCE_MAX_BYTES, UPLOAD_MAX_BYTES_DEFAULT } from '@app/shared';

import { useAddSource, useUploadSource } from '../api';

type Mode = 'url' | 'sitemap' | 'text' | 'file';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Adding knowledge: one page, a crawl, pasted text or a file (spec §12.1). */
export function AddSourceDialog({
  workspaceId,
  botId,
  triggerLabel = strings.knowledge.addSource,
}: {
  workspaceId: string;
  botId: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('url');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const add = useAddSource(workspaceId, botId);
  const upload = useUploadSource(workspaceId, botId);
  const pending = add.isPending || upload.isPending;

  const close = (): void => {
    setOpen(false);
    setLocalError(null);
    setPercent(0);
  };

  const submit = (): void => {
    setLocalError(null);
    if (mode === 'url' || mode === 'sitemap') {
      if (!isHttpUrl(url)) {
        setLocalError(strings.knowledge.urlInvalid);
        return;
      }
      add.mutate(
        mode === 'url'
          ? {
              type: 'url',
              url: url.trim(),
              ...(title.trim() === '' ? {} : { title: title.trim() }),
            }
          : { type: 'sitemap', url: url.trim() },
        { onSuccess: close },
      );
      return;
    }
    if (mode === 'text') {
      if (new TextEncoder().encode(text).length > TEXT_SOURCE_MAX_BYTES) {
        setLocalError(strings.knowledge.textTooLarge);
        return;
      }
      add.mutate({ type: 'text', title: title.trim(), body: text }, { onSuccess: close });
      return;
    }
    if (file === null) {
      setLocalError(strings.knowledge.fileTypes);
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES_DEFAULT) {
      setLocalError(strings.knowledge.fileTooLarge(UPLOAD_MAX_BYTES_DEFAULT / (1024 * 1024)));
      return;
    }
    upload.mutate(
      {
        file,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        onProgress: setPercent,
      },
      { onSuccess: close },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.knowledge.add}</DialogTitle>
          <DialogDescription>{strings.knowledge.addIntro}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="source-mode">{strings.knowledge.mode}</Label>
            <NativeSelect
              id="source-mode"
              value={mode}
              onChange={(event) => {
                const next = event.target.value;
                if (next === 'url' || next === 'sitemap' || next === 'text' || next === 'file') {
                  setMode(next);
                }
              }}
            >
              {(['url', 'sitemap', 'text', 'file'] as const).map((value) => (
                <option key={value} value={value}>
                  {strings.knowledge.modes[value]}
                </option>
              ))}
            </NativeSelect>
          </div>

          {mode === 'url' || mode === 'sitemap' ? (
            <div className="space-y-2">
              <Label htmlFor="source-url">{strings.knowledge.urlLabel}</Label>
              <Input
                id="source-url"
                value={url}
                placeholder="https://example.com/docs"
                onChange={(event) => {
                  setUrl(event.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">{strings.knowledge.urlHint}</p>
            </div>
          ) : null}

          {mode !== 'sitemap' ? (
            <div className="space-y-2">
              <Label htmlFor="source-title">{strings.knowledge.titleLabel}</Label>
              <Input
                id="source-title"
                value={title}
                maxLength={200}
                required={mode === 'text'}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            </div>
          ) : null}

          {mode === 'text' ? (
            <div className="space-y-2">
              <Label htmlFor="source-text">{strings.knowledge.textLabel}</Label>
              <textarea
                id="source-text"
                className="min-h-40 w-full rounded-md border border-input bg-transparent p-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px]"
                value={text}
                required
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            </div>
          ) : null}

          {mode === 'file' ? (
            <div className="space-y-2">
              <Label htmlFor="source-file">{strings.knowledge.fileLabel}</Label>
              <Input
                id="source-file"
                type="file"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
              <p className="text-xs text-muted-foreground">{strings.knowledge.fileTypes}</p>
            </div>
          ) : null}

          {percent > 0 && upload.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              {strings.knowledge.uploading(percent)}
            </p>
          ) : null}
          <FormAlert message={localError ?? errorMessage(add.error ?? upload.error)} />

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {strings.knowledge.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {strings.knowledge.addSourceAction}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
