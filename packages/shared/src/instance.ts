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

export type InstanceSettingsDto = z.infer<typeof instanceSettingsSchema>;
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>;
