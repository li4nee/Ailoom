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

/** `GET /api/v1/instance/public`: what the login and signup pages need before anyone signs in. */
export const instancePublicInfoSchema = z.object({
  signupMode: z.enum(SIGNUP_MODES),
  firstUser: z.boolean(),
  emailEnabled: z.boolean(),
});

export type InstancePublicInfo = z.infer<typeof instancePublicInfoSchema>;
export type InstanceSettingsDto = z.infer<typeof instanceSettingsSchema>;
export type UpdateInstanceSettingsRequest = z.infer<typeof updateInstanceSettingsRequestSchema>;
