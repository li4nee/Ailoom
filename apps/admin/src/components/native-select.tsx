// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A styled native `<select>`: fully keyboard and screen-reader accessible out of the box, and
 * the right control for short fixed lists such as a role.
 */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 rounded-md border border-input bg-card px-3 text-sm shadow-none outline-none',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
