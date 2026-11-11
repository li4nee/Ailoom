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

import { useResetPassword } from '../api';

const resetFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: strings.auth.passwordMismatch,
  });

type ResetFormValues = z.infer<typeof resetFormSchema>;

export function ResetPasswordForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const reset = useResetPassword();
  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const submit = form.handleSubmit((values) => {
    reset.mutate({ token, password: values.password }, { onSuccess });
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        <FormAlert
          message={errorMessage(reset.error, {
            token_expired: strings.auth.resetExpired,
            invalid_token: strings.auth.resetInvalid,
            password_policy: strings.auth.passwordHint,
          })}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.auth.newPassword}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>{strings.auth.passwordHint}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.auth.confirmPassword}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {strings.auth.resetPassword}
        </Button>
      </form>
    </Form>
  );
}
