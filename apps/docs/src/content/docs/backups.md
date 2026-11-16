---
title: Backups and restore
description: Back up PostgreSQL and uploaded files, then verify a restore
---

# Backups and restore

A backup contains two things: a PostgreSQL custom-format dump and a tarball of uploaded
files. The database dump is taken **after** the files tarball, so a crash mid-backup can
leave an orphan file but never a row pointing at a missing file.

## Take a backup

Run from the repository root:

```bash
bash deploy/scripts/backup.sh
bash deploy/scripts/backup.sh --out /var/backups/ailoom
bash deploy/scripts/backup.sh --age-recipient age1...
```

The result is `backups/ailoom-backup-<UTC>/` with `files.tar.gz`, `db.dump`, and
`manifest.json` (version, timestamp, SHA-256 per file). With `--age-recipient`, both
archives become `.age` files and the plaintext copies are removed.

Store backups off the host. A backup on the same disk does not survive disk loss.

## Restore

```bash
# empty database
bash deploy/scripts/restore.sh backups/ailoom-backup-20260101T000000Z

# overwrite a non-empty database
bash deploy/scripts/restore.sh backups/ailoom-backup-20260101T000000Z --force

# encrypted backup
bash deploy/scripts/restore.sh backups/ailoom-backup-20260101T000000Z \
  --identity ~/.ssh/age-key.txt
```

Exit codes: `0` success, `2` refused because the database is not empty, `3` checksum
mismatch, `1` other failure.

The script stops `api` and `worker`, verifies checksums, restores files, restores the
`public` schema, runs pending migrations, and restarts services. Postgres internals and the
ephemeral job queue are not restored; jobs are rebuilt by the worker.

## Drill checklist

Run this against a throwaway stack, not production:

- [ ] Backup completes and `manifest.json` checksums match
- [ ] Restore to an empty stack returns exit `0`
- [ ] Login and an existing conversation survive
- [ ] An uploaded document opens
- [ ] Restore without `--force` over non-empty data returns exit `2`
- [ ] A tampered archive returns exit `3`
- [ ] Encrypted backup round-trips with the identity file

The automated drill is `deploy/scripts/backup-restore.test.sh`; it exercises the full
backup → wipe → restore → verify cycle and prints `backup-restore: ok`.
