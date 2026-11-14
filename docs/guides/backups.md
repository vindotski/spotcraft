# Backups and restoring

Spotcraft keeps two kinds of backups ([ADR 0030](../decisions/0030-backups.md)):

- **Hetzner's daily backups of the server.** These are 7 images of the whole disk, on by
  default in `infra/hetzner` (`apps_server_backups`, +20% of the server's price).
- **The agent's nightly backups, to a bucket.** Every night at 03:00 UTC, each app gets a
  folder `<name>/<time>/` with:
  - `database.dump`, if the app has a database;
  - `app.json`, its settings and env;
  - `secrets.json`, its database password and deploy hook hash.

  With the R2 bucket from `infra/cloudflare`, they can't be deleted or overwritten for 29
  days, not even with the agent's key, and R2 deletes them after 30 (`backup_retention_days`).
  With another S3-compatible store, set a lifecycle rule yourself, or they are kept forever.

The dashboard's app list shows each app's backup state. It turns red when the last backup
failed or none has worked for 26 hours. On the app's page, **Back up now** makes one at once.

## Set up the bucket

1. **Enable R2** on the Cloudflare account (R2 in the Cloudflare dashboard). It asks for a
   payment method, even within the free tier, which includes 10 GB.
2. **Make the bucket.** In `infra/cloudflare`, set `backup_bucket`, e.g.
   `spotcraft-backups`, and run `tofu apply`. This module's token needs **Workers R2 Storage:
   Edit** on the account. The `backup_settings` output gives `BACKUP_S3_ENDPOINT` and
   `BACKUP_BUCKET`; add both as variables on the `production` environment.
3. **Make the agent's key.** In **R2 → Manage API tokens → Create API token**:
   - **Object Read & Write**, for the backup bucket only;
   - no expiry, or a date you'll remember.

   Add its **Access Key ID** and **Secret Access Key** as the secrets `BACKUP_ACCESS_KEY_ID`
   and `BACKUP_SECRET_ACCESS_KEY`.
4. **Deploy Spotcraft.** The agent logs `nightly backups at 03:00 UTC`.
5. In the dashboard, choose **Back up now** on each app and check that the folder appears in
   the bucket.

The bucket holds every app's env and database password. Keep it private. The key belongs only
on the server. It can write new objects, but R2's bucket lock keeps it from deleting or
overwriting a backup before it expires.

## Restore one app's database

For example, after a bad migration. You need shell access to the server as `deploy`.

**Never restore as the `postgres` superuser alone.** An app owns its database, so its dump
can hold functions that run while the dump is restored, with the restoring role's rights. The
commands below restore each part as the role that owns it: the app's own tables as the app's
role, and the `auth` schema (guests and sessions) as the agent's role, which the app can't
write to.

1. In R2, open the app's folder of the backup to restore and download `database.dump`. Restore
   only a backup you trust: the agent's key can add new folders. Copy it to the server, into a
   file only `deploy` can read:

   ```bash
   ssh deploy@<server> 'umask 077 && cat > blog.dump' < database.dump
   ```

2. On the server, restore it over the app's database. `--clean` drops what the dump has
   before recreating it, so the database ends up as it was. The role is `app_` and the app's
   name, with `-` as `_`:

   ```bash
   cd /opt/spotcraft
   docker compose exec -T postgres pg_restore -U postgres --role=app_blog --no-owner --no-privileges \
     --exclude-schema=auth --clean --if-exists -d app_blog < ~/blog.dump
   docker compose exec -T postgres pg_restore -U postgres --role=spotcraft_agent --no-owner --no-privileges \
     --schema=auth --clean --if-exists -d app_blog < ~/blog.dump
   rm ~/blog.dump
   ```

   The first command ends with two errors, `must be owner of schema auth` and `schema "auth"
   already exists`. That is the app's role being refused the agent's schema, as it should be;
   the second command restores it. Any other error needs a look.

3. In the dashboard, choose **Redeploy** on the app. That gives the app its rights on `auth`
   again, and starts it against the restored data.

## Restore after losing the server

1. Make a new server, from a Hetzner backup image or from scratch (`infra/hetzner`), and deploy
   Spotcraft as in [Getting started](../getting-started.md).
2. **With a Hetzner image,** everything is back as it was at that night's image, and you're
   done. Otherwise, go on.
3. For each app, open its latest folder in R2:
   1. In the dashboard, add the app again with the same name and settings, from `app.json`.
      Copy every env variable, `AUTH_SECRET` above all, which signs its guests' sessions.
   2. Tick **Database** if it had one, and deploy. That creates an empty database.
   3. Restore `database.dump` into it with the two commands above, then redeploy.

The new database gets a new password. The app gets it as `DATABASE_URL` when it deploys, so
`secrets.json` is only needed if you want the old one.
