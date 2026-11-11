// SPDX-License-Identifier: AGPL-3.0-only
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { getTestDataSource, resetDatabase } from '../../../test/helpers/db';
import { createUser } from '../../../test/helpers/factories';
import { WorkerAppModule } from '../../app/worker-app.module';
import { Clock, SystemClock } from '../../common/clock';
import { type AppConfig, ConfigModule, loadConfig } from '../../common/config';
import { sha256Hex } from '../../common/crypto';
import { DatabaseModule } from '../../db';
import { asUserId } from '../../db/ids';
import { JobsModule } from '../../jobs';
import { EmailModule, MemoryMailer } from '../email';
import { InstanceModule, InstanceSettingsService } from '../instance';
import { InvitationEntity } from '../workspaces/entities/invitation.entity';
import { MembershipEntity } from '../workspaces/entities/membership.entity';
import { WorkspaceEntity } from '../workspaces/entities/workspace.entity';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { EmailTokensRepository } from './email-tokens.repository';
import { EmailTokensService } from './email-tokens.service';
import { EmailTokenEntity } from './entities/email-token.entity';
import { PasswordHasher } from './password-hasher';
import { SignupService } from './signup.service';
import { UsersRepository } from './users.repository';

interface SignupContext {
  module: INestApplicationContext;
  signup: SignupService;
  settings: InstanceSettingsService;
}

interface Db {
  ds: DataSource;
}

const META = { ip: '203.0.113.5', userAgent: 'vitest' };
const SIGNUP = { email: 'new@example.com', password: 'correct horse battery', name: 'New' };

let ds: DataSource;
let mailer: MemoryMailer;
let worker: INestApplicationContext;
let withEmail: SignupContext;
let withoutEmail: SignupContext;

function configFor(emailEnabled: boolean): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://support.example.com',
    DATABASE_URL: inject('databaseUrl'),
    AUTH_SECRET: 'a'.repeat(32),
    WIDGET_SECRET: 'w'.repeat(32),
    ENCRYPTION_KEYS: `v1:${'ab'.repeat(32)}`,
    SIGNUP_MODE: 'open',
    LOG_LEVEL: 'error',
    EMAIL_TRANSPORT: emailEnabled ? 'smtp' : 'none',
    ...(emailEnabled
      ? {
          SMTP_HOST: 'localhost',
          SMTP_PORT: '2525',
          EMAIL_FROM: 'AiLoom <no-reply@example.com>',
        }
      : {}),
  });
}

async function buildSignupContext(emailEnabled: boolean): Promise<SignupContext> {
  const config = configFor(emailEnabled);
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot(config),
      {
        ...LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        global: true,
      },
      DatabaseModule.forRoot(config, ds),
      JobsModule.forApi(),
      EmailModule.forRoot({ mailer }),
      InstanceModule,
      WorkspacesModule,
    ],
    providers: [
      { provide: Clock, useClass: SystemClock },
      PasswordHasher,
      UsersRepository,
      EmailTokensRepository,
      EmailTokensService,
      SignupService,
    ],
  }).compile();
  await module.init();
  return {
    module,
    signup: module.get(SignupService),
    settings: module.get(InstanceSettingsService),
  };
}

async function seedWorkspace(t: Db, name: string): Promise<WorkspaceEntity> {
  const result = await t.ds
    .getRepository(WorkspaceEntity)
    .insert({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
  const id = result.identifiers[0] as { id: string };
  return t.ds.getRepository(WorkspaceEntity).findOneByOrFail({ id: id.id });
}

async function seedInvitation(
  t: Db,
  input: {
    workspaceId: string;
    email: string;
    role: 'admin' | 'agent';
    token: string;
    invitedBy: string;
  },
): Promise<InvitationEntity> {
  const result = await t.ds.getRepository(InvitationEntity).insert({
    workspaceId: input.workspaceId,
    email: input.email,
    role: input.role,
    tokenHash: sha256Hex(input.token),
    invitedBy: input.invitedBy,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  const id = result.identifiers[0] as { id: string };
  return t.ds.getRepository(InvitationEntity).findOneByOrFail({ id: id.id });
}

beforeAll(async () => {
  ds = await getTestDataSource();
  mailer = new MemoryMailer();
  worker = await NestFactory.createApplicationContext(
    WorkerAppModule.register(configFor(false), {
      dataSource: ds,
      mailer,
      jobs: { pollingIntervalSeconds: 0.5 },
    }),
    { logger: false },
  );
  withEmail = await buildSignupContext(true);
  withoutEmail = await buildSignupContext(false);
});

afterAll(async () => {
  await withEmail.module.close();
  await withoutEmail.module.close();
  await worker.close();
});

beforeEach(async () => {
  await resetDatabase(ds);
  mailer.sent.length = 0;
});

describe('SignupService', () => {
  it('lets the first user sign up in any mode and makes them instance admin', async () => {
    await withoutEmail.settings.setSignupMode('closed', null);

    const user = await withoutEmail.signup.signup(
      { email: 'first@x.com', password: 'correct horse battery', name: 'F' },
      META,
    );

    expect(user.isInstanceAdmin).toBe(true);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects signup in closed mode once a user exists', async () => {
    await createUser({ ds });
    await withoutEmail.settings.setSignupMode('closed', null);

    await expect(withoutEmail.signup.signup(SIGNUP, META)).rejects.toMatchObject({
      code: 'signup_closed',
    });
  });

  it('requires a matching invitation in invite mode', async () => {
    const owner = (await createUser({ ds }, { email: 'owner@example.com' })).user;
    await withoutEmail.settings.setSignupMode('invite', asUserId(owner.id));
    const workspace = await seedWorkspace({ ds }, 'Acme');
    const token = 'invite-token-abc';
    const invitation = await seedInvitation(
      { ds },
      {
        workspaceId: workspace.id,
        email: 'Invited@Example.com',
        role: 'agent',
        token,
        invitedBy: owner.id,
      },
    );

    await expect(
      withoutEmail.signup.signup({ ...SIGNUP, email: 'invited@example.com' }, META),
    ).rejects.toMatchObject({ code: 'invitation_required' });

    await expect(
      withoutEmail.signup.signup(
        { ...SIGNUP, email: 'other@example.com', invitationToken: token },
        META,
      ),
    ).rejects.toMatchObject({ code: 'invitation_required' });

    const user = await withoutEmail.signup.signup(
      { ...SIGNUP, email: ' invited@example.com ', invitationToken: token },
      META,
    );

    const membership = await ds
      .getRepository(MembershipEntity)
      .findOneByOrFail({ workspaceId: workspace.id, userId: user.id });
    expect(membership.role).toBe('agent');
    const accepted = await ds
      .getRepository(InvitationEntity)
      .findOneByOrFail({ id: invitation.id });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
  });

  it('allows anyone in open mode', async () => {
    await createUser({ ds });

    const user = await withoutEmail.signup.signup(SIGNUP, META);

    expect(user.isInstanceAdmin).toBe(false);
  });

  it('rejects duplicate emails case-insensitively', async () => {
    await createUser({ ds }, { email: 'Alice@Example.com' });

    await expect(
      withoutEmail.signup.signup({ ...SIGNUP, email: ' alice@example.com ' }, META),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('enforces password policy with details', async () => {
    await expect(
      withoutEmail.signup.signup({ ...SIGNUP, password: 'password123' }, META),
    ).rejects.toMatchObject({
      code: 'password_policy',
      details: [{ path: 'password', message: 'too_common' }],
    });
  });

  it('sends a verification email when email is enabled', async () => {
    const user = await withEmail.signup.signup(SIGNUP, META);

    expect(user.emailVerifiedAt).toBeNull();
    await vi.waitFor(
      () => {
        expect(mailer.sent.some((message) => message.to === SIGNUP.email)).toBe(true);
      },
      { timeout: 5_000 },
    );
    const sent = mailer.sent.find((message) => message.to === SIGNUP.email);
    expect(sent).toBeDefined();
    expect(sent!.subject).toMatch(/verify/i);

    const token = await ds
      .getRepository(EmailTokenEntity)
      .findOneBy({ userId: user.id, type: 'verify_email' });
    expect(token).not.toBeNull();
  });
});
