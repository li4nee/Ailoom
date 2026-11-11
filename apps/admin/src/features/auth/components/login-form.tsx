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
import { type LoginRequest, loginRequestSchema } from '@app/shared';

import { useLogin } from '../api';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const login = useLogin();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit((values) => {
    login.mutate(values, { onSuccess });
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        <FormAlert
          message={errorMessage(login.error, {
            invalid_credentials: strings.auth.invalidCredentials,
          })}
        />
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.auth.password}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {strings.auth.logIn}
        </Button>
      </form>
    </Form>
  );
}
