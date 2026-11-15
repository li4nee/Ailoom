// SPDX-License-Identifier: MIT
import { z } from 'zod';

import { SIGNUP_MODES } from './enums.js';

/** `GET /api/v1/instance/settings`. `override` means an admin's stored value beats the env. */
export const instanceSettingsSchema = z.object({
  signupMode: z.enum(SIGNUP_MODES),
  signupModeSource: z.enum(['env', 'override']),
  emailEnabled: z.boolean(),
});

export const updateInstanceSettingsRequestSchema = z.object({
  signupMode: z.enum(SIGNUP_MODES),
});

/** One diagnostics tile. `fix` is the operator action when status is not `ok`. */
export const diagnosticsCheckSchema = z.object({
  status: z.enum(['ok', 'warn', 'error']),
  detail: z.string(),
  fix: z.string().nullable(),
});

export const diagnosticsQueueSchema = z.object({
  name: z.string(),
  created: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  failed24h: z.number().int().nonnegative(),
});

/** `GET /api/health/diagnostics`: instance-admin health, with a fix for every non-ok check. */
export const diagnosticsSchema = z.object({
  version: z.string(),
  checks: z.object({
    email: diagnosticsCheckSchema,
    encryption: diagnosticsCheckSchema.extend({
      keyVersions: z.array(z.number().int()),
      rowsNeedingReencrypt: z.number().int().nonnegative(),
    }),
    storage: diagnosticsCheckSchema,
    worker: diagnosticsCheckSchema.extend({ lastBeatAt: z.string().nullable() }),
    pgvector: diagnosticsCheckSchema.extend({ version: z.string() }),
    localModel: diagnosticsCheckSchema,
    listen: diagnosticsCheckSchema,
  }),
  queues: z.array(diagnosticsQueueSchema),
  signupMode: z.enum(SIGNUP_MODES),
});

/** `GET /api/v1/instance/public`: what the login and signup pages need before anyone signs in. */
export const instancePublicInfoSchema = z.object({
  signupMode: z.enum(SIGNUP_MODES),
  firstUser: z.boolean(),
  emailEnabled: z.boolean(),
});

export type DiagnosticsCheck = z.infer<typeof diagnosticsCheckSchema>;
export type DiagnosticsQueue = z.infer<typeof diagnosticsQueueSchema>;
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
export type InstancePublicInfo = z.infer<typeof instancePublicInfoSchema>;
export type InstanceSettingsDto = z.infer<typeof instanceSettingsSchema>;
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>;
