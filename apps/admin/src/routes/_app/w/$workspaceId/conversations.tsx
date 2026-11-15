// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet } from '@tanstack/react-router';

/** `/conversations` is a layout: the inbox list and one conversation share it. */
export const Route = createFileRoute('/_app/w/$workspaceId/conversations')({
  component: Outlet,
});
