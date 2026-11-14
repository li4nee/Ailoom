// SPDX-License-Identifier: MIT
import { useState } from 'preact/hooks';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailCaptureProps {
  /** `undefined` means "skip": the email is optional. */
  onSubmit: (email?: string) => void;
}

export function EmailCapture({ onSubmit }: EmailCaptureProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: Event): void => {
    event.preventDefault();
    const value = email.trim();
    if (value === '') {
      onSubmit();
      return;
    }
    if (!EMAIL.test(value)) {
      setError('Enter a valid email address, or skip.');
      return;
    }
    setError(null);
    onSubmit(value);
  };

  return (
    <form class="ailoom-email" onSubmit={submit} noValidate>
      <label for="ailoom-email">Your email (optional)</label>
      <input
        id="ailoom-email"
        class="ailoom-input"
        type="email"
        placeholder="you@example.com"
        value={email}
        onInput={(event) => {
          setEmail((event.target as HTMLInputElement).value);
        }}
      />
      {error !== null && (
        <span class="ailoom-error" role="alert">
          {error}
        </span>
      )}
      <div class="ailoom-actions">
        <button type="submit" class="ailoom-button" data-primary="true">
          Send
        </button>
        <button
          type="button"
          class="ailoom-button"
          data-secondary="true"
          onClick={() => {
            onSubmit();
          }}
        >
          Skip
        </button>
      </div>
    </form>
  );
}
