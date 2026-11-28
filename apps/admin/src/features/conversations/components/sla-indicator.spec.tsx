// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConversationSla } from '@app/shared';

import { SlaIndicator } from './sla-indicator';

describe('SlaIndicator', () => {
  it('identifies the resolution clock when the first response is already complete', () => {
    const sla: ConversationSla = {
      firstResponseDueAt: null,
      resolutionDueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      firstResponseBreachedAt: null,
      resolutionBreachedAt: null,
    };

    render(<SlaIndicator sla={sla} />);

    expect(screen.getByText(/^Resolution: Due in/)).toBeInTheDocument();
  });
});
