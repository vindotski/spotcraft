# @spotcraft/kit

The backend kit for apps hosted on Spotcraft ([ADR 0016](../../docs/decisions/0016-backend-kit.md)).
So far it holds the `auth` schema and the code that gives an app its own database
([ADR 0015](../../docs/decisions/0015-shared-postgres.md)). Guest accounts for apps come next.
Source-only for now, like the agent: Node runs the TypeScript directly.

| Export        | What                                                                      |
| ------------- | ------------------------------------------------------------------------- |
| `./schema`    | Drizzle definitions of the `auth` tables, the SQL migrations, the version |
| `./provision` | `provision`, `purge`, `migrate`, `authSchemaVersion`, `appDatabaseName`   |

## The `auth` schema

Spotcraft owns it, as Supabase owns its `auth` schema. Apps never change it.

- `auth.users`: id, email (unique), email_verified, name, image, is_anonymous, timestamps.
  Guests and registered users share it.
- `auth.sessions`, `auth.accounts` and `auth.verifications`: Better Auth's other tables.
  Sessions and accounts are deleted with their user.
- `auth.kit_migrations`: the applied migrations. The highest version is the schema version.

Names are plural snake_case, ids are `uuid` (`gen_random_uuid()`), times are `timestamptz`.
The Drizzle definitions use Better Auth's field names (`emailVerified`) for these columns, and
a test checks that they match the SQL.

Migrations are numbered SQL files in `src/migrations` (`0001_auth.sql`, …), applied in order in
one transaction under an advisory lock, so concurrent runs wait for each other. **They only
add**: never drop or rename in a later file, so apps on an older kit keep working.

An app keeps its own data in its own tables, keyed to the user:

```sql
CREATE TABLE notes (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body    text NOT NULL
);
```

## Provisioning

`provision(adminUrl, { name, password })` runs as an admin role with `CREATEDB` and
`CREATEROLE` that is not a superuser (on the server, the agent's `spotcraft_agent`). For the app
`blog` it does the following; running it again only updates the password:

- creates or updates the role `app_blog` (login, no special attributes, 20 connections,
  `statement_timeout` 30 s, `idle_in_transaction_session_timeout` 60 s). The admin may
  `SET ROLE` to it but doesn't inherit its rights.
- creates the database `app_blog`, owned by `app_blog`. As the owner, it takes back the
  default access for everyone and lets in only the admin (`CONNECT`, `CREATE`). Only the
  owner can take that access back; the admin's own `REVOKE` would silently do nothing.
- migrates `auth` as the admin, who owns it. The app role gets `USAGE` and `SELECT, INSERT,
  UPDATE, DELETE, REFERENCES` on its tables, and only `SELECT` on `auth.kit_migrations`. It
  can't create, alter or drop anything in `auth`.

The app owns its database and `public`, and runs its own migrations there. Deleting a user as
the admin cascades into the app's tables through their foreign keys.

`purge(adminUrl, name)` drops the app's database (ending its open connections) and its role.
It does nothing if they don't exist.

`migrate(url)` only brings the `auth` schema up to date, as whoever connects. It is for apps
hosted somewhere other than Spotcraft.

## Tests

The tests need a throwaway Postgres and its superuser URL. They create their own admin role
and `app_kit_*` databases and remove them afterwards:

```bash
docker run -d --name kit-test-pg -e POSTGRES_PASSWORD=testsuper -p 127.0.0.1:55432:5432 postgres:18.6-trixie
KIT_TEST_POSTGRES_URL=postgres://postgres:testsuper@127.0.0.1:55432/postgres pnpm --filter @spotcraft/kit test
```

Without `KIT_TEST_POSTGRES_URL` they are skipped. In CI they always run (CI starts the same
Postgres image as the apps server).
