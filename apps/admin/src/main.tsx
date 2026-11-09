// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <p>Admin</p>
  </StrictMode>,
);
