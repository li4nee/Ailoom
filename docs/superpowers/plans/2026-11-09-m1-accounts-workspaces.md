# Milestone 1 — Accounts and Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can sign up (respecting signup mode), verify email, log in with short-lived JWTs and rotating refresh tokens, create workspaces, invite members with roles, and manage everything from the admin SPA — with every workspace route proven isolated.

**Architecture:** spec §4, §10, §17.2–17.3; architecture §4.3, §5.1. Authentication = 15-min access JWT (identity only) + 30-day opaque refresh token in `auth_sessions`; authorization = one Postgres query per request in `AccessGuard` (membership + role + `token_version`).

**Tech Stack:** jose, @node-rs/argon2, @fastify/cookie, @nestjs/throttler, nodemailer, resend, React 19, Vite, TanStack Router + Query, Tailwind v4, shadcn/ui, React Hook Form, Testing Library, Playwright, Mailpit.

**Spec:** `docs/spec.md`, `docs/architecture.md`. Index: `2026-11-09-00-index.md`.

## Global Constraints

All index constraints apply. Milestone-specific:

- Cookies: access `__Host-at` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900`); refresh `__Secure-rt` (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh; Max-Age=2592000`). Update spec §10.1 to name the refresh cookie `__Secure-rt` in Task 1.6.
- Route params are named `<resource>Id` (`:workspaceId`, `:userId`, `:invitationId`, `:sessionId`, `:botId`, …), never bare `:id`, so the isolation suite can map them to fixtures.
- Not-a-member → `404 not_found`; member with too low a role → `403 forbidden`.
- Argon2id parameters: memory 19456 KiB, iterations 2, parallelism 1.
- Fastify `trustProxy: 1` (exactly one hop: Caddy) so `req.ip` is the client IP.

## Review Focus (this milestone)

1. **Two browser tabs refresh at the same moment.** The second presents an already-rotated refresh token. Expected: if the rotation happened < 10 s ago, respond `401 refresh_race` without revoking the session family; the admin client retries with the cookie the other tab received. → Task 1.4 test `treats a rotation within 10 s as a race, not theft`, Task 1.14 test.
2. **Email address case and whitespace** (`" Alice@Example.com "`). Expected: trimmed, stored as entered (citext), logins match case-insensitively, invitations match case-insensitively. → Tasks 1.3, 1.11.
3. **Login timing for unknown emails.** Expected: an Argon2 verification still runs so response time does not reveal whether the account exists. → Task 1.6 test asserts `hasher.verifyDummy` was called.
4. **Owner tries to leave, demote themselves, or delete their account while sole owner.** Expected: `409 sole_owner` with a message pointing to ownership transfer. → Tasks 1.11, 1.12.
5. **Expired access token on a mutating request with a long form open.** Expected: the client refreshes once and replays the same request with the same body, not a lost form. → Task 1.14 test.

---

### Task 1.1: Password policy and hasher

**Files:**

- Create: `apps/api/src/modules/auth/domain/{password-policy.ts,common-passwords.txt}`, `apps/api/src/modules/auth/password-hasher.ts`
- Create: `packages/shared/src/auth.ts` (password length constants + request/response schemas used in 1.6)
- Test: `apps/api/src/modules/auth/domain/password-policy.spec.ts`, `apps/api/src/modules/auth/password-hasher.spec.ts`

**Interfaces:**

- Produces:
  - shared: `PASSWORD_MIN = 10`, `PASSWORD_MAX = 128`, `passwordSchema` (length only), `signupRequestSchema` `{ email, password, name, invitationToken? }`, `loginRequestSchema` `{ email, password }`, `meResponseSchema` `{ id, email, name, emailVerified, isInstanceAdmin, memberships: { workspaceId, workspaceName, role }[] }`, `sessionSchema` `{ sessionId, userAgent, ip, lastUsedAt, createdAt, current }`. Email fields: `z.string().trim().email().max(254)`.
  - `type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'contains_email'`; `checkPassword(password: string, ctx: { email: string }): PasswordProblem[]`
  - `class PasswordHasher { hash(pw: string): Promise<string>; verify(hash: string, pw: string): Promise<boolean>; verifyDummy(pw: string): Promise<void>; needsRehash(hash: string): boolean }`

- [ ] **Step 1: Write failing tests**

```ts
it.each([
  ['short', ['too_short']],
  ['x'.repeat(129), ['too_long']],
  ['password123', ['too_common']],
  ['alice-secret-pass', ['contains_email']],
  ['correct horse battery', []],
])('%s → %j', (pw, problems) =>
  expect(checkPassword(pw, { email: 'alice@example.com' })).toEqual(problems),
);
it('checks common passwords case-insensitively', () =>
  expect(checkPassword('PassWord123', { email: 'a@b.c' })).toContain('too_common'));

it('hashes with argon2id OWASP params', async () =>
  expect(await hasher.hash('correct horse battery')).toMatch(
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
  ));
it('verifies', async () => {
  const h = await hasher.hash('a'.repeat(12));
  expect(await hasher.verify(h, 'a'.repeat(12))).toBe(true);
  expect(await hasher.verify(h, 'b'.repeat(12))).toBe(false);
});
it('flags weaker hashes for rehash', () =>
  expect(hasher.needsRehash('$argon2id$v=19$m=4096,t=3,p=1$c2FsdA$aGFzaA')).toBe(true));
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:unit -- src/modules/auth` → FAIL.
- [ ] **Step 3: Implement.** `common-passwords.txt` = top 10,000 entries of SecLists `10-million-password-list-top-10000.txt` (MIT; add attribution line to `THIRD_PARTY_NOTICES.md`), loaded once into a lowercase `Set`. `contains_email` = password contains the email local part when that part is ≥ 4 chars. `verifyDummy` verifies against a fixed precomputed hash.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(auth): password policy and argon2id hasher"`

---

### Task 1.2: Email transport, templates, `email.send` job

**Files:**

- Create: `apps/api/src/modules/email/{mailer.ts,smtp.mailer.ts,resend.mailer.ts,log.mailer.ts,memory.mailer.ts,email.service.ts,email.processor.ts,email.module.ts,index.ts}`
- Create: `apps/api/src/modules/email/templates/{layout.ts,verify-email.ts,reset-password.ts,invitation.ts,security-alert.ts,index.ts}`
- Test: `apps/api/src/modules/email/templates/templates.spec.ts`, `apps/api/src/modules/email/email.int.spec.ts`

**Interfaces:**

- Consumes: `defineJob`, `JobsService`, `@JobProcessor` (0.16), `AppConfig.email` (0.5).
- Produces:
  - `interface Mailer { send(m: { to: string; subject: string; text: string; html: string }): Promise<void> }`, token `MAILER`; `MemoryMailer.sent: Array<…>` for tests
  - `type EmailTemplateName = 'verify_email' | 'reset_password' | 'invitation' | 'security_alert'` (later milestones append `handoff_requested`, `agent_reply`, `spend_alert`)
  - `renderTemplate(name: EmailTemplateName, data: TemplateData[name], ctx: { publicUrl: URL; productName: string }): { subject: string; text: string; html: string }`
  - `EmailService.send<N extends EmailTemplateName>(name: N, to: string, data: TemplateData[N], opts?: { manager?: EntityManager }): Promise<void>` — enqueues `email.send` (retryLimit 5, backoff, concurrency 4)
  - `EmailService.isEnabled(): boolean` (`transport !== 'none'`)

- [ ] **Step 1: Write failing tests**

```ts
it('escapes user data in html', () =>
  expect(
    renderTemplate(
      'invitation',
      { inviterName: '<script>x</script>', workspaceName: 'W', token: 't', role: 'agent' },
      ctx,
    ).html,
  ).not.toContain('<script>x</script>'));
it('builds links from PUBLIC_URL', () =>
  expect(renderTemplate('verify_email', { name: 'A', token: 'tok' }, ctx).text).toContain(
    'https://support.example.com/verify-email?token=tok',
  ));
it.each(['verify_email', 'reset_password', 'invitation', 'security_alert'] as const)(
  '%s has subject, text and html',
  (n) =>
    expect(renderTemplate(n, sampleData[n], ctx)).toMatchObject({
      subject: expect.any(String),
      text: expect.any(String),
      html: expect.stringContaining('<html'),
    }),
);
// email.int.spec.ts (MemoryMailer bound to MAILER, worker processing enabled)
it('delivers through the job queue', async () => {
  await email.send('verify_email', 'a@b.c', { name: 'A', token: 't' });
  await vi.waitFor(() => expect(mailer.sent).toHaveLength(1), { timeout: 5000 });
  expect(mailer.sent[0]).toMatchObject({ to: 'a@b.c', subject: expect.stringMatching(/verify/i) });
});
it('does not send when enqueued in a rolled-back transaction', async () => {
  /* manager + throw → 0 sent after 2 s */
});
it('log mailer never logs the body at info', async () => {
  /* LogMailer with captured pino stream → info line has to+subject only */
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:unit -- src/modules/email && pnpm --filter @app/api test:int -- src/modules/email` → FAIL.
- [ ] **Step 3: Implement.** Templates are plain functions using a tiny `html` tagged template that escapes interpolations. `MAILER` factory picks SMTP (nodemailer), Resend (`resend` SDK, `fetch` = global fetch: Resend is a fixed public host, not user-supplied), or Log. Product name = config project name.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(email): pluggable mailers, escaped templates and email.send job"`

---

### Task 1.3: Users and signup service

**Files:**

- Create: `apps/api/src/modules/auth/{users.repository.ts,signup.service.ts}`, `apps/api/src/modules/instance/{instance-settings.repository.ts,instance-settings.service.ts}`
- Create: `apps/api/test/helpers/factories.ts`
- Test: `apps/api/src/modules/auth/signup.service.int.spec.ts`

**Interfaces:**

- Consumes: `PasswordHasher`, `checkPassword` (1.1), `EmailService` (1.2).
- Produces:
  - `UsersRepository` (non-tenant): `findById(id)`, `findByEmail(email)` (citext), `insert(data)`, `update(id, patch)`, `count()`, `incrementTokenVersion(id, manager?)`.
  - `InstanceSettingsService.getSignupMode(): Promise<'open' | 'invite' | 'closed'>` (row `signup_mode` overrides config), `setSignupMode(mode, byUserId)`.
  - `SignupService.signup(input: SignupRequest, meta: { ip: string; userAgent: string }): Promise<UserEntity>` — errors `signup_closed` (403), `invitation_required` (403), `email_taken` (409), `password_policy` (400, `details` = problems).
  - factories: `createUser(t: TestApp, o?: { email?: string; password?: string; name?: string; verified?: boolean; isInstanceAdmin?: boolean }): Promise<{ user: UserEntity; password: string }>` (direct insert, default verified).

- [ ] **Step 1: Write failing tests**

```ts
it('lets the first user sign up in any mode and makes them instance admin', async () => {
  settings.override('closed');
  const u = await signup.signup(
    { email: 'first@x.com', password: 'correct horse battery', name: 'F' },
    meta,
  );
  expect(u.isInstanceAdmin).toBe(true);
});
it('rejects signup in closed mode once a user exists', async () => {
  await createUser(t);
  settings.override('closed');
  await expect(signup.signup(input, meta)).rejects.toMatchObject({ code: 'signup_closed' });
});
it('requires a matching invitation in invite mode', async () => {
  /* no token → invitation_required; token for other email → invitation_required; valid → ok and marks invitation accepted + membership */
});
it('allows anyone in open mode', async () => {
  /* ok, not instance admin */
});
it('rejects duplicate emails case-insensitively', async () => {
  await createUser(t, { email: 'Alice@Example.com' });
  await expect(
    signup.signup({ ...input, email: ' alice@example.com ' }, meta),
  ).rejects.toMatchObject({ code: 'email_taken' });
});
it('enforces password policy with details', async () =>
  expect(signup.signup({ ...input, password: 'password123' }, meta)).rejects.toMatchObject({
    code: 'password_policy',
    details: [{ path: 'password', message: 'too_common' }],
  }));
it('sends a verification email when email is enabled', async () => {
  /* MemoryMailer gets verify_email */
});
it('auto-verifies when EMAIL_TRANSPORT=none', async () => {
  /* emailVerifiedAt set, no mail */
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:int -- src/modules/auth/signup` → FAIL.
- [ ] **Step 3: Implement.** First-user check and insert run in one transaction with `LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE` so two simultaneous first signups cannot both become instance admin. Verification token creation is shared with Task 1.8 (`EmailTokensService.issue(userId, 'verify_email', ttlHours: 24)` — create it here with its unit test `issues a hashed single-use token`).
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(auth): signup with signup modes, first-user instance admin and verification email"`

---

### Task 1.4: Access tokens and refresh sessions

**Files:**

- Create: `apps/api/src/modules/auth/{token.service.ts,sessions.repository.ts,sessions.service.ts}`
- Test: `apps/api/src/modules/auth/token.service.spec.ts`, `apps/api/src/modules/auth/sessions.service.int.spec.ts`

**Interfaces:**

- Produces:
  - `type AccessClaims = { sub: UserId; sid: string; tv: number; iat: number; exp: number }`
  - `TokenService.issueAccess(p: { userId: UserId; sessionId: string; tokenVersion: number }): Promise<string>`; `verifyAccess(jwt: string): Promise<AccessClaims>` (tries every `AUTH_SECRET`; errors `token_expired` 401, `unauthorized` 401)
  - `SessionsService.create(userId, meta: { userAgent: string; ip: string }): Promise<{ session: AuthSessionEntity; refreshToken: string }>`
  - `SessionsService.rotate(refreshToken: string, meta): Promise<{ session; refreshToken; user: UserEntity }>` — errors `session_expired`, `session_revoked`, `refresh_race`
  - `SessionsService.revoke(sessionId)`, `revokeAllForUser(userId, manager?)` (also increments `token_version`), `listForUser(userId)`, `revokeOne(userId, sessionId)` (`not_found` if not theirs)

- [ ] **Step 1: Write failing tests**

```ts
// token.service.spec.ts (FixedClock)
it('issues HS256 tokens with the expected claims and 15 min ttl', async () => {
  const jwt = await tokens.issueAccess({ userId, sessionId: 's1', tokenVersion: 3 });
  expect(decodeProtectedHeader(jwt).alg).toBe('HS256');
  expect(await tokens.verifyAccess(jwt)).toMatchObject({ sub: userId, sid: 's1', tv: 3, exp: now + 900 });
});
it('accepts tokens signed with an older secret', async () => { /* sign with secrets[1] → verify ok */ });
it('rejects expired tokens with token_expired', async () => { clock.advance(901_000); await expect(tokens.verifyAccess(jwt)).rejects.toMatchObject({ code: 'token_expired' }); });
it('rejects tampered tokens', async () => { /* flip a char → unauthorized */ });
// sessions.service.int.spec.ts
it('stores only the hash of refresh tokens', async () => { const { refreshToken, session } = await sessions.create(userId, meta);
  expect(session.refreshTokenHash).toBe(sha256Hex(refreshToken)); expect(JSON.stringify(await rawRow(session.id))).not.toContain(refreshToken); });
it('rotates: old token stops working, new one works, same family', async () => { … });
it('revokes the whole family and emails the user on reuse', async () => {
  const a = await sessions.create(userId, meta); const b = await sessions.rotate(a.refreshToken, meta);
  clock.advance(11_000);
  await expect(sessions.rotate(a.refreshToken, meta)).rejects.toMatchObject({ code: 'session_revoked' });
  await expect(sessions.rotate(b.refreshToken, meta)).rejects.toMatchObject({ code: 'session_revoked' });
  expect(mailer.sentTemplates()).toContain('security_alert');
});
it('treats a rotation within 10 s as a race, not theft', async () => {
  const a = await sessions.create(userId, meta); const b = await sessions.rotate(a.refreshToken, meta);
  clock.advance(5_000);
  await expect(sessions.rotate(a.refreshToken, meta)).rejects.toMatchObject({ code: 'refresh_race' });
  await expect(sessions.rotate(b.refreshToken, meta)).resolves.toBeDefined();
});
it('expires after 30 days', async () => { clock.advance(30 * 86400_000 + 1); /* → session_expired */ });
it('revokeAllForUser bumps token_version', async () => { /* before 0, after 1; all sessions revoked */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** On rotate: `SELECT … FOR UPDATE` the row by hash; if revoked: if `revoked_reason = 'rotated'` and `now - revoked_at < 10 s` → `refresh_race`, else revoke family (`revoked_reason = 'reuse_detected'`) + `security_alert` email + `session_revoked`. Add column `revoked_reason text` (`rotated` | `logout` | `logout_all` | `reuse_detected` | `password_change`) to `auth_sessions` via migration and to spec §9.1.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(auth): access jwt and rotating refresh sessions with reuse detection"`

---

### Task 1.5: `AccessGuard`, role and principal decorators

**Files:**

- Create: `apps/api/src/modules/auth/{access.guard.ts,decorators.ts,principal.ts,access.repository.ts}`
- Test: `apps/api/test/e2e/access-guard.e2e.spec.ts` (registers test-only controllers through `createTestApp({ controllers })`)

**Interfaces:**

- Consumes: `TokenService` (1.4), `asWorkspaceId` (0.8).
- Produces:
  - `type Principal = { userId: UserId; sessionId: string; isInstanceAdmin: boolean; emailVerified: boolean; workspace: { id: WorkspaceId; role: Role } | null }`
  - Decorators: `@Public()`, `@RequireRole(role: Role)`, `@InstanceAdminOnly()`, `@RequireVerifiedEmail()`, param decorator `@CurrentPrincipal()`
  - `AccessRepository.load(userId: UserId, workspaceId: WorkspaceId | null): Promise<{ tokenVersion: number; isInstanceAdmin: boolean; emailVerified: boolean; role: Role | null } | null>` — **one SQL query** joining `users`, `memberships`, and `workspaces` (`deleted_at IS NULL`)
  - Global guard registration in `HttpAppModule`; it also writes `userId`/`workspaceId` into the CLS context.

- [ ] **Step 1: Write failing tests**

```ts
it('401 without a cookie', async () => expect((await t.http.get('/api/__t/me')).status).toBe(401));
it('lets @Public routes through', async () =>
  expect((await t.http.get('/api/__t/public')).status).toBe(200));
it('401 session_revoked when token_version changed', async () => {
  const c = await loginAs(t, user);
  await sessions.revokeAllForUser(user.id);
  expect((await authed(t, c).get('/api/__t/me')).body.error.code).toBe('session_revoked');
});
it('404 for non-members', async () =>
  expect((await authed(t, outsider).get(`/api/v1/workspaces/${ws}/__t`)).status).toBe(404));
it('404 for malformed workspace ids', async () =>
  expect((await authed(t, owner).get('/api/v1/workspaces/not-a-uuid/__t')).status).toBe(404));
it('404 for deleted workspaces', async () => {
  /* set deleted_at → 404 */
});
it('403 when role is too low', async () =>
  expect((await authed(t, agent).get(`/api/v1/workspaces/${ws}/__t/admin-only`)).status).toBe(403));
it('owner satisfies admin', async () =>
  expect((await authed(t, owner).get(`/api/v1/workspaces/${ws}/__t/admin-only`)).status).toBe(200));
it('runs exactly one query per request', async () => {
  const spy = countQueries(t.ds);
  await authed(t, owner).get(`/api/v1/workspaces/${ws}/__t/noop`);
  expect(spy.count()).toBe(1);
});
```

(`loginAs` / `authed` are created in Task 1.6; until then this test file builds the cookie with `TokenService` directly through a local helper.)

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** Role rank `owner 3 > admin 2 > agent 1`. Access cookie name `__Host-at`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(auth): single-query access guard with roles and principal"`

---

### Task 1.6: Auth endpoints and test factories

**Files:**

- Create: `apps/api/src/modules/auth/{auth.controller.ts,auth.service.ts,cookies.ts,auth.mapper.ts,auth.module.ts,index.ts}`
- Modify: `apps/api/test/helpers/factories.ts` (`loginAs`, `authed`), `docs/spec.md` §10.1 (refresh cookie name `__Secure-rt`), `packages/shared/src/errors.ts`
- Test: `apps/api/test/e2e/auth.e2e.spec.ts`

**Interfaces:**

- Consumes: 1.1–1.5.
- Produces:
  - Routes from spec §17.2 (minus verify/forgot/reset, done in 1.8): `POST /api/v1/auth/signup|login|logout|logout-all|refresh`, `GET/PATCH /api/v1/auth/me`, `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:sessionId`
  - `loginAs(t: TestApp, user: { email: string }, password: string): Promise<string[]>` (Set-Cookie values); `authed(t: TestApp, cookies: string[]): supertest.Agent` (adds cookies, `X-Requested-With: fetch`, `Origin: <PUBLIC_URL origin>`)
  - Error codes appended: `invalid_credentials`, `signup_closed`, `invitation_required`, `email_taken`, `password_policy`, `token_expired`, `session_expired`, `session_revoked`, `refresh_race`, `email_not_verified`, `csrf_failed`, `invalid_token`, `sole_owner`, `cannot_modify_owner`

- [ ] **Step 1: Write failing tests**

```ts
it('login sets both cookies with exact attributes', async () => {
  const res = await t.http.post('/api/v1/auth/login').set(fetchHeaders).send({ email, password });
  expect(res.status).toBe(200);
  expect(cookie(res, '__Host-at')).toMatch(/HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=900/);
  expect(cookie(res, '__Secure-rt')).toMatch(/HttpOnly; Secure; SameSite=Strict; Path=\/api\/v1\/auth\/refresh; Max-Age=2592000/);
  expect(res.body).not.toHaveProperty('token');
});
it('wrong password and unknown email look identical', async () => {
  const a = await login(email, 'wrong-password-123'); const b = await login('nobody@x.com', 'wrong-password-123');
  expect([a.status, b.status]).toEqual([401, 401]); expect(a.body.error.code).toBe(b.body.error.code);
  expect(hasherSpy.verifyDummy).toHaveBeenCalled();
});
it('refresh rotates both cookies', async () => { … });
it('logout revokes the session and clears cookies', async () => { /* Max-Age=0 for both; refresh with old rt → 401 */ });
it('logout works with only the refresh cookie', async () => { … });
it('logout-all invalidates other devices immediately', async () => {
  const c1 = await loginAs(t, user, pw), c2 = await loginAs(t, user, pw);
  await authed(t, c1).post('/api/v1/auth/logout-all');
  expect((await authed(t, c2).get('/api/v1/auth/me')).status).toBe(401);
});
it('me returns memberships', async () => { … meResponseSchema.parse(body) });
it('password change requires the current password, revokes other sessions, keeps this one', async () => { … });
it('lists sessions with the current one flagged and revokes another', async () => { … });
it('cannot revoke someone else’s session', async () => { /* 404 */ });
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @app/api test:e2e -- test/e2e/auth` → FAIL.
- [ ] **Step 3: Implement.** Password change: verify current → `checkPassword` → rehash → `revokeAllForUser` (bumps `token_version`) → create a new session for this device and set fresh cookies. Successful login rehashes when `needsRehash`.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(auth): login, logout, refresh, me and session management endpoints"`

---

### Task 1.7: CSRF protection and rate limits

**Files:**

- Create: `apps/api/src/common/security/{csrf.guard.ts,rate-limit.ts}`
- Modify: `apps/api/src/app/create-http-app.ts` (`trustProxy: 1`, `@fastify/helmet` for API responses)
- Test: `apps/api/test/e2e/csrf-rate-limit.e2e.spec.ts`

**Interfaces:**

- Produces: `CsrfGuard` (global, applies to `/api/v1/**` mutating methods); throttler named limits `login` (10 / 15 min keyed `ip + lowercased email`), `signup` and `forgot` (5 / hour per IP), `admin` (600 / min per user id, default for authenticated `/api/v1`); decorator `@RateLimit(name)`. 429 → `rate_limited` with `Retry-After` seconds.

- [ ] **Step 1: Write failing tests**

```ts
it('rejects mutating requests without X-Requested-With', async () =>
  expect((await t.http.post('/api/v1/auth/login').set('Origin', origin).send(creds)).body.error.code).toBe('csrf_failed'));
it('rejects a foreign Origin', async () =>
  expect((await t.http.post('/api/v1/auth/login').set({ 'X-Requested-With': 'fetch', Origin: 'https://evil.test' }).send(creds)).status).toBe(403));
it('allows GET without the header', async () => expect((await authed(t, c).get('/api/v1/auth/me').unset('X-Requested-With')).status).toBe(200));
it('limits login attempts per ip+email', async () => {
  for (let i = 0; i < 10; i++) await login(email, 'bad-password-123');
  const res = await login(email, 'bad-password-123');
  expect(res.status).toBe(429); expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  expect((await login('other@x.com', 'bad-password-123')).status).toBe(401);
});
it('uses the client ip from one proxy hop', async () => { /* X-Forwarded-For different values → separate buckets */ });
it('limits signup to 5 per hour per ip', async () => { … });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** with `@nestjs/throttler` (in-memory storage, documented single-instance limitation) and custom tracker functions.
- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(security): csrf origin checks and auth rate limits"`

---

### Task 1.8: Email verification and password reset

**Files:**

- Create: `apps/api/src/modules/auth/{email-tokens.service.ts,account-recovery.service.ts}` (extend `email-tokens.service.ts` from 1.3)
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Test: `apps/api/test/e2e/verify-reset.e2e.spec.ts`

**Interfaces:**

- Produces: routes `POST /api/v1/auth/verify-email {token}`, `POST /resend-verification` (auth, limit `forgot`), `POST /forgot-password {email}` (always `200 {}`), `POST /reset-password {token, password}`. Token TTLs: verify 24 h, reset 1 h. `EmailTokensService.consume(token, type): Promise<EmailTokenEntity>` (errors `invalid_token`, `token_expired`).

- [ ] **Step 1: Write failing tests**

```ts
it('verifies once', async () => { const tok = await issueVerify(user);
  expect((await post('/verify-email', { token: tok })).status).toBe(200);
  expect((await post('/verify-email', { token: tok })).body.error.code).toBe('invalid_token'); });
it('expires verify tokens after 24 h', async () => { clock.advance(24 * 3600_000 + 1); /* token_expired */ });
it('forgot-password never reveals existence', async () => {
  const a = await post('/forgot-password', { email: 'nobody@x.com' }); const b = await post('/forgot-password', { email });
  expect([a.status, b.status, a.text === b.text]).toEqual([200, 200, true]);
  expect(mailer.sentTo('nobody@x.com')).toHaveLength(0); expect(mailer.sentTo(email)).toHaveLength(1);
});
it('reset sets the password and logs out everywhere', async () => {
  const c = await loginAs(t, user, pw); const tok = await lastResetToken(email);
  expect((await post('/reset-password', { token: tok, password: 'brand new password 1' })).status).toBe(200);
  expect((await authed(t, c).get('/api/v1/auth/me')).status).toBe(401);
  expect((await login(email, 'brand new password 1')).status).toBe(200);
});
it('reset tokens expire after 1 h and are single use', async () => { … });
it('reset enforces password policy', async () => { … password_policy });
```

- [ ] **Step 2–4: Fail → implement → pass** (`pnpm --filter @app/api test:e2e -- test/e2e/verify-reset`).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(auth): email verification and password reset flows"`

---

### Task 1.9: Audit log service

**Files:**

- Create: `apps/api/src/modules/audit/{audit.service.ts,audit.repository.ts,audit.controller.ts,audit.mapper.ts,audit.module.ts,index.ts}`, `packages/shared/src/audit.ts`
- Test: `apps/api/src/modules/audit/audit.service.int.spec.ts`

**Interfaces:**

- Produces:
  - `AUDIT_ACTIONS` (shared, extended by later milestones): `member.invited`, `member.invitation_revoked`, `member.joined`, `member.role_changed`, `member.removed`, `workspace.created`, `workspace.updated`, `workspace.ownership_transferred`, `workspace.deleted`, `instance.signup_mode_changed`
  - `AuditService.record(entry: { workspaceId: WorkspaceId | null; actorUserId: UserId | null; action: AuditAction; targetType: string; targetId: string | null; metadata?: Record<string, unknown>; ip?: string | null }, manager?: EntityManager): Promise<void>` — drops metadata keys matching `/secret|password|token|api.?key|authorization|cookie/i` at any depth.
  - `GET /api/v1/workspaces/:workspaceId/audit-log?cursor&limit` (admin) → `Page<AuditEntryDto>`

- [ ] **Step 1: Write failing tests**

```ts
it('scrubs secret-looking metadata keys at any depth', async () => {
  await audit.record({ ...base, metadata: { label: 'x', apiKey: 'sk', nested: { password: 'p', ok: 1 } } });
  expect((await lastAudit()).metadata).toEqual({ label: 'x', nested: { ok: 1 } });
});
it('writes inside the caller transaction', async () => { /* rollback → no row */ });
it('takes the ip from the request context when not given', async () => { … });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(audit): audit log service with secret scrubbing"`

---

### Task 1.10: Workspaces and memberships

**Files:**

- Create: `apps/api/src/modules/workspaces/{workspaces.controller.ts,workspaces.service.ts,workspaces.repository.ts,memberships.repository.ts,workspaces.mapper.ts,workspaces.module.ts,index.ts}`, `apps/api/src/modules/workspaces/domain/slug.ts`, `packages/shared/src/workspaces.ts`
- Modify: `apps/api/test/helpers/factories.ts` (`createWorkspace`, `addMember`)
- Test: `apps/api/src/modules/workspaces/domain/slug.spec.ts`, `apps/api/test/e2e/workspaces.e2e.spec.ts`

**Interfaces:**

- Produces:
  - Routes: `POST /api/v1/workspaces` (verified users; `email_not_verified` 403 otherwise), `GET /api/v1/workspaces`, `GET /api/v1/workspaces/:workspaceId` (agent), `PATCH /api/v1/workspaces/:workspaceId` (admin; `name`, `settings.notificationEmails`), `GET /api/v1/workspaces/:workspaceId/members` (admin)
  - `WorkspacesService.create(ownerId: UserId, input: { name: string }): Promise<WorkspaceEntity>` — emits hook `WorkspaceCreatedHook` (Nest event `workspace.created`) used by Task 2.6
  - `slugify(name: string): string` (lowercase ascii, `-` separated, max 40) + 4-char random suffix
  - factories: `createWorkspace(t, owner: UserEntity, name?): Promise<WorkspaceEntity>`, `addMember(t, ws, user, role): Promise<void>`

- [ ] **Step 1: Write failing tests**

```ts
it.each([['Acme Inc.', 'acme-inc'], ['  Ünïcödé  ', 'unicode'], ['!!!', 'workspace']])('slugify(%s)', (n, s) => expect(slugify(n)).toBe(s));
it('creates a workspace with the creator as owner', async () => { … role 'owner', audit workspace.created });
it('requires a verified email', async () => { … 403 email_not_verified });
it('lists only my workspaces', async () => { … });
it('agents can read but not update', async () => { GET 200, PATCH 403 });
it('validates notification emails', async () => { PATCH settings.notificationEmails ['not-an-email'] → 400 validation_failed, details path settings.notificationEmails.0 });
it('members list hides password hashes and token versions', async () => { expect(JSON.stringify(body)).not.toMatch(/argon2|tokenVersion|password/); });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(workspaces): workspace creation, listing, settings and members list"`

---

### Task 1.11: Invitations, member management, ownership transfer

**Files:**

- Create: `apps/api/src/modules/workspaces/{invitations.controller.ts,invitations.service.ts,invitations.repository.ts,members.service.ts}`
- Test: `apps/api/test/e2e/invitations-members.e2e.spec.ts`

**Interfaces:**

- Produces routes (spec §17.3, params renamed): `POST/GET /api/v1/workspaces/:workspaceId/invitations`, `DELETE …/invitations/:invitationId`, `POST /api/v1/invitations/accept {token}` (auth), `PATCH/DELETE …/members/:userId`, `POST …/transfer-ownership {userId}` (owner). Invitation TTL 7 days; one pending invitation per (workspace, email) — re-inviting replaces the old token. `InvitationsService.findValidByToken(token): Promise<InvitationEntity | null>` used by signup (1.3).

- [ ] **Step 1: Write failing tests**

```ts
it('admin invites; email contains the accept link', async () => { … mailer has invitation with /invite?token= });
it('agent cannot invite', async () => { 403 });
it('cannot invite with role owner', async () => { 400 validation_failed });
it('accepting requires the invited email (case-insensitive)', async () => { other user → 403 invalid_token; matching ' BOB@x.com ' → membership agent });
it('re-inviting replaces the previous token', async () => { old token → invalid_token });
it('expired invitations fail', async () => { clock + 7d → token_expired });
it('admin changes agent → admin; cannot touch the owner', async () => { PATCH owner → 403 cannot_modify_owner });
it('cannot set role owner via PATCH', async () => { 400 });
it('admin removes an agent; removed user gets 404 next request', async () => { … });
it('owner transfers ownership; old owner becomes admin', async () => { … audit workspace.ownership_transferred });
it('owner cannot remove or demote themselves', async () => { 409 sole_owner });
it('transfer target must be a member', async () => { 404 });
```

- [ ] **Step 2–4: Fail → implement → pass.** Transfer runs in one transaction: demote old owner first, then promote (the partial unique index enforces one owner).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(workspaces): invitations, role changes, removal and ownership transfer"`

---

### Task 1.12: Workspace deletion and account deletion

**Files:**

- Create: `apps/api/src/modules/workspaces/{workspace-purge.job.ts,workspace-purge.processor.ts}`, `apps/api/src/modules/auth/account-deletion.service.ts`
- Test: `apps/api/test/e2e/deletion.e2e.spec.ts`, `apps/api/src/modules/workspaces/workspace-purge.int.spec.ts`

**Interfaces:**

- Produces:
  - `DELETE /api/v1/workspaces/:workspaceId` (owner) → sets `deleted_at`, audits, enqueues `workspace.purge { workspaceId }` (retryLimit 3, concurrency 1)
  - `PURGE_ORDER: string[]` — every tenant table in child-before-parent order; a test asserts it equals the set of tables with a `workspace_id` column (so new tables can't be forgotten)
  - `WorkspacePurgeProcessor` deletes in batches of 1,000 rows per table per statement, then the workspace row. File blobs are deleted by Task 3.1's extension of this processor.
  - `DELETE /api/v1/auth/me {password}` → `409 sole_owner` if the user is the only owner of any non-deleted workspace; otherwise deletes memberships, revokes sessions, deletes the user (messages keep content; `author_user_id` FK is `ON DELETE SET NULL`).

- [ ] **Step 1: Write failing tests**

```ts
it('PURGE_ORDER covers every tenant table', async () => {
  const tables = (await ds.query(`SELECT table_name FROM information_schema.columns WHERE column_name='workspace_id' AND table_schema='public'`)).map((r: any) => r.table_name);
  expect([...PURGE_ORDER].sort()).toEqual([...tables].sort());
});
it('deleted workspace is immediately 404 for members', async () => { … });
it('purge removes every row with that workspace_id and nothing else', async () => {
  // seed rows in ws A and ws B across all tables available so far; run purge(A)
  for (const tbl of PURGE_ORDER) expect(await count(tbl, wsA)).toBe(0);
  expect(await count('memberships', wsB)).toBeGreaterThan(0);
});
it('purge is idempotent', async () => { run twice → no error });
it('sole owner cannot delete their account', async () => { 409 sole_owner });
it('account deletion requires the password', async () => { wrong → 401 invalid_credentials });
it('deleted users show as null author on messages', async () => { … after Task 0.17 schema: insert agent message, delete user, author_user_id null });
```

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(workspaces): soft delete with background purge and account deletion"`

---

### Task 1.13: Instance settings endpoint

**Files:**

- Create: `apps/api/src/modules/instance/{instance.controller.ts,instance.module.ts,index.ts}`
- Test: `apps/api/test/e2e/instance.e2e.spec.ts`

**Interfaces:**

- Produces: `GET /api/v1/instance/settings` → `{ signupMode, signupModeSource: 'env' | 'override', emailEnabled }`; `PUT /api/v1/instance/settings { signupMode }` (`@InstanceAdminOnly`). Diagnostics and health come in Task 7.3.

- [ ] **Step 1: Write failing tests** — non-admin → 403 `forbidden`; admin sets `open` → next signup allowed; audit `instance.signup_mode_changed` with `workspaceId: null`; instance admins get no access to other workspaces (`GET /api/v1/workspaces/:otherWs` → 404).
- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(instance): instance admin signup mode setting"`

---

### Task 1.14: Admin SPA foundation

**Files:**

- Modify: `apps/admin/{package.json,vite.config.ts,index.html,src/main.tsx}`
- Create: `apps/admin/src/{router.tsx,query-client.ts,strings.ts,styles.css}`, `apps/admin/components.json`, `apps/admin/src/components/ui/*` (shadcn: button, input, label, form, card, dialog, dropdown-menu, select, table, tabs, toast, badge, skeleton, alert), `apps/admin/src/lib/{api-client.ts,api-error.ts,auth-refresh.ts}`
- Test: `apps/admin/src/lib/api-client.spec.ts`

**Interfaces:**

- Produces:
  - `api<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; schema: z.ZodType<T>; signal?: AbortSignal }): Promise<T>` — prefixes `/api`, sends `X-Requested-With: fetch`, JSON; on `401` with code `token_expired` or `unauthorized`: single-flight `POST /api/v1/auth/refresh` (`navigator.locks.request('auth-refresh')`), then replays the original request once with the same body; on `refresh_race` waits 300 ms and replays; on refresh failure calls `onSessionLost()` (navigates to `/login?next=<current>`)
  - `class ApiError extends Error { code: ErrorCode; status: number; details: { path: string; message: string }[]; requestId: string }`
  - Vitest + jsdom + Testing Library configured (`pnpm --filter @app/admin test`)

- [ ] **Step 1: Write failing tests**

```ts
it('parses successful responses with the schema', async () => { mockFetch(200, { a: 1 }); expect(await api('/x', { schema: z.object({ a: z.number() }) })).toEqual({ a: 1 }); });
it('throws ApiError from the envelope', async () => { mockFetch(400, { error: { code: 'validation_failed', message: 'm', details: [], requestId: 'req_1' } });
  await expect(api('/x', { schema })).rejects.toMatchObject({ code: 'validation_failed', requestId: 'req_1' }); });
it('refreshes once and replays the same body', async () => {
  fetchSeq([[401, err('token_expired')], [200, {}], [200, { ok: true }]]);
  await api('/v1/x', { method: 'POST', body: { name: 'draft' }, schema });
  expect(calls()).toEqual([['POST', '/api/v1/x', '{"name":"draft"}'], ['POST', '/api/v1/auth/refresh', ''], ['POST', '/api/v1/x', '{"name":"draft"}']]);
});
it('concurrent 401s trigger one refresh', async () => { … refresh called once for 3 parallel requests });
it('retries after refresh_race', async () => { … });
it('redirects to login when refresh fails', async () => { … onSessionLost called with current path });
it('fails loudly when the response does not match the schema', async () => { … ApiError code 'internal_error' with message 'Unexpected response shape' });
```

- [ ] **Step 2–4: Fail → implement → pass.** Tailwind v4 via `@tailwindcss/vite`; TanStack Router via `@tanstack/router-plugin/vite` (file routes in `src/routes/`); all user-facing text in `strings.ts`.
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): spa foundation with typed api client and silent token refresh"`

---

### Task 1.15: Admin authentication pages

**Files:**

- Create: `apps/admin/src/routes/(auth)/{login.tsx,signup.tsx,verify-email.tsx,forgot-password.tsx,reset-password.tsx,invite.tsx}`, `apps/admin/src/features/auth/{api.ts,components/*}`
- Test: `apps/admin/src/features/auth/*.spec.tsx`

**Interfaces:**

- Consumes: `api`, shared auth schemas.
- Produces: `useMe()` query (`['me']`), `useLogin()`, `useSignup()`, `useLogout()` mutations; routes listed above; `/invite?token=` shows workspace + role and offers "Accept" (logged in) or "Sign up / Log in to accept".

- [ ] **Step 1: Write failing component tests**

Login: submitting wrong credentials shows `strings.auth.invalidCredentials`; success navigates to `next` param or `/`. Signup: `password_policy` details render one message per problem from `strings.auth.passwordProblems`; `signup_closed` shows the closed notice; first-user hint shown when no users exist yet — add the `@Public()` route `GET /api/v1/instance/public` → `{ signupMode, firstUser: boolean, emailEnabled }` to Task 1.13's controller (e2e test included here: unauthenticated call works and leaks nothing else). Verify-email: token from URL is posted once; success and `token_expired` states render. Reset: mismatch between password and confirmation is caught client-side.

- [ ] **Step 2–4: Fail → implement → pass** (`pnpm --filter @app/admin test -- src/features/auth`).
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): login, signup, verification, reset and invitation pages"`

---

### Task 1.16: Admin shell and settings pages

**Files:**

- Create: `apps/admin/src/routes/_app.tsx` (auth layout), `apps/admin/src/routes/_app/{index.tsx,new-workspace.tsx}`, `apps/admin/src/routes/_app/w/$workspaceId/{route.tsx,index.tsx,settings/{general,members,invitations,audit-log}.tsx}`, `apps/admin/src/routes/_app/account/{index.tsx,sessions.tsx}`, `apps/admin/src/routes/_app/instance.tsx`
- Create: `apps/admin/src/features/{workspaces,members,account,instance}/{api.ts,components/*}`, `apps/admin/src/components/{app-shell.tsx,workspace-switcher.tsx,role-gate.tsx}`
- Test: component tests per feature

**Interfaces:**

- Produces: `<RoleGate min="admin">` (renders children only when the current membership role ≥ min); nav items Bots, Knowledge, Conversations, Usage, Settings (non-built pages show a "Coming in a later milestone" placeholder); layout redirects to `/new-workspace` when the user has no memberships.

- [ ] **Step 1: Write failing component tests**

Agents don't see invite/role/remove controls (`RoleGate`); owner sees "Transfer ownership"; removing a member asks for confirmation in a dialog (no `window.confirm`); sessions page marks the current session and "Log out everywhere" calls `/logout-all` then routes to `/login`; delete account shows `sole_owner` error text when returned; instance page visible only to instance admins.

- [ ] **Step 2–4: Fail → implement → pass.**
- [ ] **Step 5: Commit** — `git commit -s -m "feat(admin): app shell, workspace switcher and settings pages"`

---

### Task 1.17: Isolation fixtures for accounts and workspaces

**Files:**

- Modify: `apps/api/test/isolation/{isolation-fixtures.ts,isolation.e2e.spec.ts}`
- Create: `apps/api/test/isolation/isolation-context.ts`

**Interfaces:**

- Produces: `buildIsolationContext(t: TestApp): Promise<IsolationContext>` (two workspaces A/B, an owner each, cookies for B's owner, plus an agent in A); fixtures `userId` (an agent in A), `invitationId` (pending invitation in A).

- [ ] **Step 1: Extend the suite**

For each workspace route: call it as **B's owner** with A's `workspaceId` and A's resource ids in the path (and in the body where the route accepts ids, e.g. `transfer-ownership { userId }`) → expect `404`. Also call it as B's owner with **B's** `workspaceId` but A's resource ids → expect `404`. `GET /api/v1/workspaces` as B never lists A.

- [ ] **Step 2: Run** — `pnpm --filter @app/api test:e2e -- test/isolation` → PASS with 0 uncovered routes.
- [ ] **Step 3: Commit** — `git commit -s -m "test(isolation): cover account and workspace routes"`

---

### Task 1.18: Browser end-to-end harness

**Files:**

- Create: `e2e/{package.json,playwright.config.ts,fixtures.ts,mailpit.ts}`, `e2e/tests/accounts.spec.ts`, `deploy/docker-compose.e2e.yml`, `.env.e2e`
- Modify: `.github/workflows/ci.yml` (job `e2e-browser`), root `package.json` (`"e2e": "pnpm --filter @app/e2e test"`)

**Interfaces:**

- Produces: Playwright fixtures `stack` (compose up/down with `--wait`, base URL `http://localhost:8080`), `mailpit.lastEmailTo(address): Promise<{ subject; text }>`, `extractLink(text, path): string`; `docker-compose.e2e.yml` adds `mailpit` and sets `EMAIL_TRANSPORT=smtp`, `SMTP_HOST=mailpit`, `SMTP_PORT=1025`.

- [ ] **Step 1: Write the browser test**

`accounts.spec.ts`: first visitor signs up → verification email arrives in Mailpit → open link → create workspace "Acme" → dashboard shows "Acme" → invite `agent@acme.test` as agent → in a second browser context sign up via the invite link → agent lands in "Acme" and the Members page shows no invite button → owner logs out everywhere → owner's other context is redirected to `/login` on next navigation.

- [ ] **Step 2: Run** — `pnpm e2e` → PASS.
- [ ] **Step 3: Add CI job** `e2e-browser` (needs `docker` job images; uploads `playwright-report` on failure).
- [ ] **Step 4: Commit and tag**

```bash
git add -A
git commit -s -m "test(e2e): playwright harness with mailpit and accounts flow"
git tag m1-done
```
