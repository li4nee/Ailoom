---
title: Upgrades
description: Move between 0.x releases without skipping migrations
---

# Upgrades

AiLoom is a public beta and remains pre-1.0. Read the release notes and the "Upgrade notes" section of
[CHANGELOG.md](https://github.com/li4nee/ailoom/blob/main/CHANGELOG.md) before every
upgrade.

## Procedure

1. Take a backup and keep it off the host. See [Backups](/backups/).
2. Set `VERSION` in `.env` to the new release tag (for example `v0.1.0`).
3. Pull the images and recreate the stack:

   ```bash
   docker compose -f deploy/docker-compose.yml --env-file .env pull
   docker compose -f deploy/docker-compose.yml --env-file .env up -d --wait
   ```

   The one-shot `migrate` service runs before `api` and `worker` start.

4. Check health and the diagnostics page:

   ```bash
   curl "$PUBLIC_URL/api/health/ready"
   ```

5. Open the admin, log in, and ask a bot a question.

## Rules

- **Never skip `migrate`.** Migrations are ordered and may include data backfills. The
  compose stack enforces this; a manual deployment must run them before the new API starts.
- **Do not skip releases without testing.** The upgrade workflow starts from the oldest
  supported tag, but you should still run the same path on staging.
- **Rolling back code does not roll back the schema.** Restore the pre-upgrade backup if a
  release must be undone.
- Keep the previous image tag available until the new version has served traffic.

## Automated upgrade test

`deploy/scripts/upgrade-test.sh FROM_TAG TO_REF` builds both versions, starts the old one,
creates data through the API, swaps images, migrates, and verifies login, row counts, and a
new answer. CI runs it nightly from the oldest release and on every published release.
