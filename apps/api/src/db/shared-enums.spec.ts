// SPDX-License-Identifier: AGPL-3.0-only
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { EMAIL_TOKEN_TYPES, INVITATION_ROLES, ROLES } from '@app/shared';

import { EmailTokenEntity } from '../modules/auth/entities/email-token.entity';
import { InvitationEntity } from '../modules/workspaces/entities/invitation.entity';
import { MembershipEntity } from '../modules/workspaces/entities/membership.entity';

/** The `enum` option TypeORM was given for `target.property`. */
function enumOf(target: abstract new () => unknown, property: string): unknown {
  const column = getMetadataArgsStorage().columns.find(
    (candidate) => candidate.target === target && candidate.propertyName === property,
  );
  return column?.options.enum;
}

describe('shared enums', () => {
  it('ROLES lists the workspace roles, owner first', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'agent']);
  });

  it('EMAIL_TOKEN_TYPES lists the token purposes', () => {
    expect(EMAIL_TOKEN_TYPES).toEqual(['verify_email', 'reset_password']);
  });

  it('INVITATION_ROLES excludes owner: an owner cannot be invited', () => {
    expect(INVITATION_ROLES).toEqual(['admin', 'agent']);
  });

  it('are plain arrays, not TypeScript enum objects', () => {
    for (const list of [ROLES, EMAIL_TOKEN_TYPES, INVITATION_ROLES]) {
      expect(Array.isArray(list)).toBe(true);
    }
  });

  it('are the lists the enum columns are declared with', () => {
    expect(enumOf(MembershipEntity, 'role')).toBe(ROLES);
    expect(enumOf(EmailTokenEntity, 'type')).toBe(EMAIL_TOKEN_TYPES);
    expect(enumOf(InvitationEntity, 'role')).toBe(INVITATION_ROLES);
  });
});
