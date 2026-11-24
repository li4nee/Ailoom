# Security review — v0.1.0

Date: 2026-11-16
Reviewed tree: `0fc1fcb` (branch `feat/m7-launch`) plus this document
Reviewer: engineering (self-review against spec §20 and architecture §9)

This review records only checks that were actually executed locally. GitHub-side
configuration (private vulnerability reporting, CodeQL result triage, OpenSSF
Scorecard runs) is listed as not verified here rather than assumed to pass.

## 1. Scope

- API (`apps/api`), admin (`apps/web`), widget (`packages/widget`), shared
  packages and the Caddy web image.
- Deployment assets in `deploy/`: Dockerfiles, compose file, Caddyfile, upgrade
  and backup scripts.
- Dependency graph for production installs.
- Out of scope: authenticated DAST, third-party penetration test, multi-instance
  rate limiting (Phase 1 is single-instance), and live-provider abuse testing.

## 2. Executed checks and results

| Check                   | Command (abridged)                                                                                 | Result                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Production audit        | `pnpm audit --prod`                                                                                | Pass — `No known vulnerabilities found`                                             |
| Unit tests              | `pnpm --filter @app/api test`                                                                      | Pass — 73 files, 606 tests, 7 skipped                                               |
| End-to-end tests        | `pnpm --filter @app/api test:e2e`                                                                  | Pass — 35 files, 231 tests                                                          |
| Typecheck               | `pnpm --filter @app/api typecheck`                                                                 | Pass                                                                                |
| Lint                    | `pnpm lint`                                                                                        | Pass — 1 pre-existing warning in `live.contract.spec.ts:142`                        |
| Build                   | `pnpm build`                                                                                       | Pass — 5 tasks                                                                      |
| Migrations              | `pnpm --filter @app/api db:migrate`, `db:check`                                                    | Pass — 22 loaded, no pending, no schema drift                                       |
| Secret-leak e2e         | part of `test:e2e` (`secret-leak.e2e.spec.ts`)                                                     | Pass — 1 test                                                                       |
| CSRF and rate-limit e2e | part of `test:e2e` (`csrf-rate-limit.e2e.spec.ts`)                                                 | Pass                                                                                |
| Tenant isolation e2e    | part of `test:e2e` (`test/isolation/`)                                                             | Pass — every workspace and widget route covered                                     |
| Trivy filesystem scan   | `trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed .`                             | Pass — 0 HIGH/CRITICAL (excluding `node_modules`, `.git`)                           |
| Trivy API image         | `trivy image --severity HIGH,CRITICAL --ignore-unfixed ghcr.io/li4nee/ailoom-api:demo`             | Pass — 0 HIGH/CRITICAL                                                              |
| Trivy web image         | same for `ghcr.io/li4nee/ailoom-web:demo`                                                          | 1 HIGH — accepted, see §4.1                                                         |
| Semgrep                 | `semgrep scan --config p/default --config p/typescript --config p/nodejs --config p/owasp-top-ten` | 217 rules, 562 files, 6 findings — 1 fixed, 5 false positives/intentional, see §4.2 |
| ZAP baseline (admin)    | `zap-baseline.py -t http://localhost:18091`                                                        | 0 FAIL, 4 WARN, 64 PASS — see §4.3                                                  |
| Release workflow lint   | `actionlint .github/workflows/*.yml`                                                               | Pass                                                                                |

The e2e suite was rerun after the secret-box and dependency changes; the results
above are from that run, not from earlier commits.

## 3. Findings fixed in this milestone

| ID    | Finding                                                                                                                                                               | Fix                                                                                                                           | Commit    |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| SEC-1 | Transitive `glob` and `minimatch` advisories (ReDoS) and an `esbuild` dev-server advisory were reachable from the production tree.                                    | Pinned patched ranges with pnpm overrides in `pnpm-workspace.yaml`; verified install, build, migrations and entity discovery. | `de686fe` |
| SEC-2 | AES-256-GCM unsealing did not validate the stored IV length and did not pass `authTagLength`, so a truncated tag/IV could be accepted depending on the OpenSSL build. | `secret-box.ts` now rejects non-12-byte IVs and passes `{ authTagLength: 16 }`; regression test added.                        | `ead9f54` |
| SEC-3 | The API runtime image shipped npm, pulling bundled `undici`/`brace-expansion` advisories into an image that never uses npm.                                           | Removed npm/npx from the runtime stage; image rescanned to 0 HIGH/CRITICAL.                                                   | `b6035c6` |
| SEC-4 | Admin CSP lacked `form-action` and there was no `Permissions-Policy`; ZAP flagged both.                                                                               | Caddy now sends `form-action 'self'` and disables camera, microphone, geolocation, payment and USB.                           | `0fc1fcb` |

## 4. Accepted residual risks

### 4.1 Caddy web image ships `golang.org/x/net v0.60.0` (CVE-2026-78661, HIGH)

The `caddy:2-alpine` (2.11.9) binary embeds `golang.org/x/net v0.60.0`; the
fixed release is 0.62.0. There is no newer upstream Caddy image at review time.

Why it is accepted for v0.1.0:

- The advisory is an O(n²) allocation in the HTML parser's text-node coalescing.
  Caddy's request path does not parse request bodies or proxied responses as
  HTML; it serves static files and reverse-proxies JSON/SSE to the API.
- The image runs as the non-root `caddy` user with a read-only site root.
- Concrete trigger: an attacker would need to make Caddy parse crafted HTML,
  which no route in this deployment does.

Follow-up: bump the base image as soon as a Caddy release ships x/net ≥ 0.62.0;
Renovate tracks the image. Re-scan at that point; do not close this item before.
As of 2026-11-24 the runtime stage is pinned to
`caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0`,
whose `caddy build-info` still reports `golang.org/x/net v0.60.0`, so this item stays open.

### 4.2 Semgrep dispositions

| Rule / location                                   | Disposition                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `crypto` GCM tag handling in `secret-box.ts`      | Real finding — fixed in `ead9f54`.                                                                   |
| Origin echoed in `widget-cors.ts`                 | Intentional: the widget must answer the embedding origin; the allowlist is enforced before the echo. |
| `http://` and `fetch` in specs                    | Test-only fixtures against local servers.                                                            |
| `NODE_TLS_REJECT_UNAUTHORIZED` in a provider test | Test-only, scoped to that spec.                                                                      |
| Non-literal `RegExp` in a spec                    | Test input, not request data.                                                                        |

### 4.3 ZAP baseline warnings

After the header fix the baseline reports 4 warning classes, all reviewed:

- `10049` Storable and Cacheable Content — hashed, immutable JS asset. Cacheable
  by design.
- `10055` CSP `style-src 'unsafe-inline'` — the admin bundle sets inline style
  attributes; moving to nonces would require a server-rendered shell. No
  script-src relaxation exists, so XSS impact stays bounded.
- `10109` Modern Web Application — informational SPA detection, not a weakness.
- `90004` Cross-Origin-Embedder-Policy missing — deliberately not enabled: the
  admin embeds widget previews in an iframe, and COEP would require every
  embedded resource to opt in with CORP. The widget responses already send
  `Cross-Origin-Resource-Policy: cross-origin`; admin pages send `same-origin`.
  Revisit if previews move to a separate origin.

The ZAP run is an unauthenticated baseline against the admin shell. Authenticated
DAST and API fuzzing were not executed.

## 5. Spec §20 and architecture §9 evidence

| Requirement               | Enforcement                                                                                                                                                                                          | Evidence                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF                      | Single `safeFetch`: http/https only, allowed ports, DNS resolved once and pinned, private/loopback/link-local/CGNAT/metadata ranges rejected, redirects re-validated, size and time limits           | `apps/api/src/common/safe-fetch/safe-fetch.ts:116`; rejection-class tests in `safe-fetch.int.spec.ts:210-357`; crawl path uses it in `fetch-page.ts:69` |
| Input validation          | Zod on body/query/param, unknown fields rejected; 1 MB JSON limit                                                                                                                                    | `apps/api/src/app/create-http-app.ts:25,82-83`; per-route schemas across `apps/api/src/modules/**`                                                      |
| Uploads                   | Magic-byte validation before the blob is written; random stored names, never served as HTML                                                                                                          | `apps/api/src/modules/knowledge/sources.service.ts:163`                                                                                                 |
| XSS                       | Widget renders text/allowlisted Markdown, link hosts filtered; ESLint bans `innerHTML` and `dangerouslySetInnerHTML`; strict CSP                                                                     | `packages/widget/src/main/render/markdown.spec.tsx:23`; `packages/eslint-config/src/index.ts:87-99`; `deploy/Caddyfile`                                 |
| Prompt injection          | Retrieved chunks and visitor text are delimited and escaped; no tools in Phase 1; non-clickable injected URLs                                                                                        | `prompt-assembly.ts` test "escapes delimiter text…" (`prompt-assembly.spec.ts:52`); `rag-quality.int.spec.ts:216`                                       |
| CSRF                      | `SameSite=Lax`, `X-Requested-With`, `Origin` check on mutations                                                                                                                                      | `apps/api/test/e2e/csrf-rate-limit.e2e.spec.ts:34,46`                                                                                                   |
| Tenant isolation          | `TenantRepository`, `WorkspaceGuard` 404s, lint rule against cross-tenant access                                                                                                                     | `apps/api/test/isolation/isolation.e2e.spec.ts:85,94`; `widget-isolation.e2e.spec.ts:161`                                                               |
| Secrets at rest           | AES-256-GCM, key versions, IV and tag length enforced, no secret fields in DTOs                                                                                                                      | `apps/api/src/common/crypto/secret-box.ts`; `secret-box.spec.ts`                                                                                        |
| Secrets in logs           | Pino redaction before serialization plus provider-layer redaction                                                                                                                                    | `apps/api/src/common/logging/logger.options.ts:25-31`; `logger.options.spec.ts:23`; `secret-leak.e2e.spec.ts:242`                                       |
| Rate limits and spend cap | Decorator-driven limits per scope; in-memory store documented as single-instance; soft spend cap                                                                                                     | `apps/api/src/common/security/rate-limit.ts`; `csrf-rate-limit.e2e.spec.ts:67,102`                                                                      |
| Abuse controls            | Optional proof-of-work, link policy, no images/raw HTML in answers                                                                                                                                   | `apps/api/test/e2e/challenge.e2e.spec.ts`; `markdown.spec.tsx:93`                                                                                       |
| Security headers          | Helmet on API; HSTS, CSP, `Permissions-Policy`, `X-Frame-Options` and CORP split by route on Caddy                                                                                                   | `create-http-app.ts:87`; `deploy/Caddyfile`; `widget-assets.ts`                                                                                         |
| Supply chain              | Frozen lockfile in CI/Docker, Renovate with 7-day release age and pinned action digests, `pnpm audit --prod`, CodeQL, Scorecard, non-root images, SBOM/provenance and cosign in the release workflow | `pnpm-workspace.yaml` overrides; `.github/renovate.json`; `.github/workflows/codeql.yml`, `scorecard.yml`, `release.yml`; `apps/api/Dockerfile`         |
| Disclosure                | `SECURITY.md` with private contact and 90-day window                                                                                                                                                 | `SECURITY.md`                                                                                                                                           |

## 6. Not verified in this review

- GitHub private vulnerability reporting and Scorecard/CodeQL result triage:
  require repository access not available in this environment.
- Real fork/tag release publish, image signing verification and SBOM attestation:
  workflow is actionlint-clean and locally reviewed, but no publish was run.
- Authenticated DAST, API fuzzing and third-party penetration testing.
- TLS termination and HSTS behaviour behind a real proxy/DNS setup.
- Multi-instance rate-limit storage (Phase 5). The in-memory store is documented
  as a single-instance constraint.

## 7. Conclusion

No open HIGH-severity issue is reachable through the shipped request paths. The
Caddy base-image advisory is an upstream packaging issue with no path from this
deployment's routes; it is tracked and must be rechecked on the next Caddy
release. Remaining ZAP warnings are design choices documented above.

Security gate for v0.1.0: **pass with the accepted residual risks in §4**, subject
to the unverified external items in §6 being completed by the release operator.
