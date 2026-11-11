// SPDX-License-Identifier: AGPL-3.0-only
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { type CreateWorkspaceRequest, createWorkspaceRequestSchema } from '@app/shared';

import { useCreateWorkspace } from '../api';

export function CreateWorkspaceForm({ onCreated }: { onCreated: (workspaceId: string) => void }) {
  const create = useCreateWorkspace();
  const form = useForm<CreateWorkspaceRequest>({
    resolver: zodResolver(createWorkspaceRequestSchema),
    defaultValues: { name: '' },
  });

  const submit = form.handleSubmit((values) => {
    create.mutate(values, {
      onSuccess: (workspace) => {
        onCreated(workspace.id);
      },
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="max-w-md space-y-4" noValidate>
        <FormAlert
          message={errorMessage(create.error, { email_not_verified: strings.invite.verifyFirst })}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.workspaces.name}</FormLabel>
              <FormControl>
                <Input maxLength={100} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={create.isPending}>
          {strings.workspaces.create}
        </Button>
      </form>
    </Form>
  );
}
