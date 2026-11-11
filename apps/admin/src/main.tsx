// SPDX-License-Identifier: AGPL-3.0-only
import './styles.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createAppRouter } from './router';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}

const { router, queryClient } = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
