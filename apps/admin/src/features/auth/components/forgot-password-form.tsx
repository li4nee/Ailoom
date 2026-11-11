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
import { type ForgotPasswordRequest, forgotPasswordRequestSchema } from '@app/shared';

import { useForgotPassword } from '../api';

/** Always shows the same confirmation, so the page never reveals which emails have accounts. */
export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });

  if (forgot.isSuccess) return <p role="status">{strings.auth.forgotSent}</p>;

  const submit = form.handleSubmit((values) => {
    forgot.mutate(values.email);
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        <FormAlert message={errorMessage(forgot.error)} />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.auth.email}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={forgot.isPending}>
          {strings.auth.forgotSubmit}
        </Button>
      </form>
    </Form>
  );
}
