---
title: Nightly dumps of every app to a bucket, and Hetzner backups of the server
number: 30
status: accepted
implementation: done
date: 2026-11-14
supersedes: []
superseded_by: []
notes: "Built: the agent's nightly backup (pg_dump plus app.json and secrets.json) to an S3-compatible bucket, an R2 bucket with a lifecycle rule and a bucket lock in infra/cloudflare, a restore that runs as the owning roles, Hetzner backups on by default, the dashboard's backup status and Back up now. No alerts beyond the dashboard."
---

# Nightly dumps of every app to a bucket, and Hetzner backups of the server

## Context

ADR 0015 put every app's data in one Postgres on the server and left backups as the next
decision. Until now:
- the only copy of the app databases and settings was the server's disk;
- Hetzner's server backups were off by default;
- there was no object storage, no scheduler and no alerting.

Losing the server, or one bad migration, loses the apps' guests and their data.

## Decision

- **Two layers.**
  - **Hetzner's daily backups of the server** are on by default (`apps_server_backups` in
    `infra/hetzner`). They keep 7 images, crash-consistent, of the whole disk: the app list,
    the databases, Caddy's data and `.env`.
  - **The agent's nightly backups** go to an S3-compatible bucket outside Hetzner, made in
    `infra/cloudflare` as an R2 bucket. A lifecycle rule deletes objects after
    `backup_retention_days`, 30 by default, and a bucket lock keeps them from being deleted or
    overwritten a day less than that, with any key. They are the copy that survives losing
    the provider, and the way to restore one app.
- **What the agent backs up,** for every app at 03:00 UTC, into `<name>/<time>/`:
  - `database.dump`, if the app has a database. This is `pg_dump --format=custom`, run inside
    the Postgres container as the superuser over its local socket, because the agent's role
    doesn't own the apps' tables.
  - `app.json` and `secrets.json`. A restored database is of little use without its
    `AUTH_SECRET`, which signs the guests' sessions, and the database password.
- **How it runs.**
  - Each app's backup takes its turn in the agent's queue, so it never overlaps one of its
    deploys, and deploys can run between apps.
  - The dump is held in memory, up to 32 MB. A larger one fails with that reason.
  - `pg_dump` gives up on a table lock after 30 s, and on the whole dump after 5 minutes,
    killed inside the container too. Each upload has a minute.
  - A backup on request is refused while one for the same app is waiting.
  - The upload is a signed S3 `PUT`, using the agent's own SigV4 code with no new dependency.
- **Settings.** All four or none: `BACKUP_S3_ENDPOINT`, `BACKUP_BUCKET`,
  `BACKUP_ACCESS_KEY_ID` and `BACKUP_SECRET_ACCESS_KEY`. The key is an R2 token made by hand,
  scoped to the bucket with object read and write, so OpenTofu's own token needs no right to
  make tokens.
- **Status.**
  - Each app's last attempt goes into `apps/<name>/backup.json`, with the time, the size and
    the error, plus when a backup last worked.
  - The dashboard's app list shows each app's backup state, which turns red when the last one
    failed or none has worked for 26 hours.
  - The app page has **Back up now**.
  - There are no notifications: alerting is a later decision.
- **Restoring is by hand,** from the guide: download the folder from R2, `pg_restore` into the
  app's database, put back the env if the app is new, redeploy.
- **A restore never runs as the superuser alone.** An app owns its database, so its dump can
  hold functions that run during the restore (in a CHECK constraint, say) with the restoring
  role's rights. The guide restores the app's schemas with `--role=app_<name>` and `auth` with
  `--role=spotcraft_agent`, both `--no-owner --no-privileges`. A redeploy then grants the app
  its rights on `auth` again.

## Consequences

- Losing the server, or Hetzner, loses at most a day of app data.
- The bucket holds secrets: every app's env and database password. It is private, and the key
  can reach only that bucket. Whoever can read it can read the apps' data and secrets, so the
  key belongs only on the server. The key can add objects, so a restore picks a backup it
  trusts; it can't delete or overwrite one before the lock expires.
- A failure shows only in the dashboard and the agent's log. Someone has to look.
- A database whose dump is over 32 MB isn't backed up until the dump streams to a file; the
  status says so.
- Retention and the lock come from the R2 bucket in `infra/cloudflare`. Another S3-compatible
  store needs its own lifecycle rule, or keeps backups forever.
- R2 must be enabled on the Cloudflare account, which asks for a payment method even within
  the free tier.
- Restoring isn't a button. It is a documented procedure, rehearsed against the same Postgres
  image.
