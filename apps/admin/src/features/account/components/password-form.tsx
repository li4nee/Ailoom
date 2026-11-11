// SPDX-License-Identifier: AGPL-3.0-only
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormAlert } from '@/components/form-alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { passwordSchema } from '@app/shared';

import { useUpdateMe } from '../api';

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, {
    path: ['confirm'],
    message: strings.auth.passwordMismatch,
  });

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

/** The server signs every other device out and returns fresh cookies for this one. */
export function PasswordForm() {
  const update = useUpdateMe();
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const submit = form.handleSubmit((values) => {
    update.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          form.reset();
        },
      },
    );
  });

  const fields = [
    ['currentPassword', strings.account.currentPassword, 'current-password'],
    ['newPassword', strings.auth.newPassword, 'new-password'],
    ['confirm', strings.auth.confirmPassword, 'new-password'],
  ] as const;

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="max-w-md space-y-3" noValidate>
        <h2 className="text-lg font-semibold">{strings.account.changePassword}</h2>
        <FormAlert
          message={errorMessage(update.error, {
            invalid_credentials: strings.account.wrongPassword,
            password_policy: strings.auth.passwordHint,
          })}
        />
        {update.isSuccess ? <p role="status">{strings.account.passwordChanged}</p> : null}
        {fields.map(([name, label, autoComplete]) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete={autoComplete} {...field} />
                </FormControl>
                {name === 'newPassword' ? (
                  <FormDescription>{strings.auth.passwordHint}</FormDescription>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <Button type="submit" disabled={update.isPending}>
          {strings.account.changePassword}
        </Button>
      </form>
    </Form>
  );
}
