// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { strings } from '@/strings';

/**
 * An accessible confirmation (never `window.confirm`). The dialog stays open while the action
 * runs and shows its error; it closes only on success.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = true,
  error,
  pending,
  onConfirm,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  error: string | null;
  pending: boolean;
  onConfirm: (close: () => void) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <FormAlert message={error} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{strings.workspaces.cancel}</Button>
          </DialogClose>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => {
              onConfirm(() => {
                setOpen(false);
              });
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
