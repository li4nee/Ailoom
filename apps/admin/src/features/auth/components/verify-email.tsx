// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';

import { errorCode } from '@/lib/error-message';
import { strings } from '@/strings';

import { useVerifyEmail } from '../api';

/**
 * Posts the token from the link exactly once. The ref survives React's development double
 * mount, so a token is never spent twice (the second call would answer `invalid_token`).
 */
export function VerifyEmail({ token }: { token: string }) {
  const verify = useVerifyEmail();
  const started = useRef(false);
  const { mutate } = verify;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mutate(token);
  }, [mutate, token]);

  if (verify.isSuccess) return <p role="status">{strings.auth.verifySuccess}</p>;
  if (verify.isError) {
    return (
      <p role="alert">
        {errorCode(verify.error) === 'token_expired'
          ? strings.auth.verifyExpired
          : strings.auth.verifyInvalid}
      </p>
    );
  }
  return <p role="status">{strings.auth.verifying}</p>;
}
