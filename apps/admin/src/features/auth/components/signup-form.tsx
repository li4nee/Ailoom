// SPDX-License-Identifier: AGPL-3.0-only
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { FormAlert } from '@/components/form-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { ApiError } from '@/lib/api-error';
import { errorMessage } from '@/lib/error-message';
import { strings } from '@/strings';
import { type SignupRequest, signupRequestSchema } from '@app/shared';

import { usePublicInfo, useSignup } from '../api';

/** One line per password-policy problem the server reported; unknown codes are skipped. */
function passwordProblems(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'password_policy') return [];
  return error.details.flatMap((detail) => {
    const known: Partial<Record<string, string>> = strings.auth.passwordProblems;
    const text = known[detail.message];
    return text === undefined ? [] : [text];
  });
}

export function SignupForm({
  invitationToken,
  onSuccess,
}: {
  invitationToken?: string;
  onSuccess: () => void;
}) {
  const info = usePublicInfo();
  const signup = useSignup();
  const form = useForm<SignupRequest>({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit((values) => {
    const input = invitationToken === undefined ? values : { ...values, invitationToken };
    signup.mutate(input, { onSuccess });
  });

  const problems = passwordProblems(signup.error);

  return (
    <Form {...form}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {info.data?.firstUser === true ? (
          <Alert>
            <AlertDescription>{strings.auth.firstUserHint}</AlertDescription>
          </Alert>
        ) : null}
        <FormAlert
          message={
            problems.length > 0
              ? null
              : errorMessage(signup.error, {
                  signup_closed: strings.auth.signupClosed,
                  invitation_required: strings.auth.invitationRequired,
                  email_taken: strings.auth.emailTaken,
                })
          }
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
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>{strings.auth.passwordHint}</FormDescription>
              <FormMessage />
              {problems.length > 0 ? (
                <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={signup.isPending}>
          {strings.auth.signUp}
        </Button>
      </form>
    </Form>
  );
}
