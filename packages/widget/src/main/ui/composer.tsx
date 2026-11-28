// SPDX-License-Identifier: MIT
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { t } from '../i18n';

const MAX_COMPOSER_HEIGHT = 120;

export interface ComposerProps {
  disabled: boolean;
  onSend: (content: string) => void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = input.current;
    if (element === null) return;
    element.style.height = 'auto';
    element.style.height = `${String(Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT))}px`;
    element.style.overflowY = element.scrollHeight > MAX_COMPOSER_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  const send = (): void => {
    const content = value.trim();
    if (content === '' || disabled) return;
    setValue('');
    onSend(content);
  };

  return (
    <div class="ailoom-composer">
      <textarea
        ref={input}
        class="ailoom-input"
        aria-label={t('inputPlaceholder')}
        placeholder={t('inputPlaceholder')}
        rows={1}
        value={value}
        disabled={disabled}
        onInput={(event) => {
          setValue((event.target as HTMLTextAreaElement).value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <button type="button" class="ailoom-send" disabled={disabled} onClick={send}>
        {t('send')}
      </button>
    </div>
  );
}
