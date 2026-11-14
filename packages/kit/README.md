# @spotcraft/kit

The backend kit for server-rendered apps hosted on Spotcraft
([ADR 0016](https://github.com/vindotski/spotcraft/blob/main/docs/decisions/0016-backend-kit.md)). For now it gives an app **guest
accounts**: a visitor gets an account without signing up, and the app keeps their data under
its id. It also holds the `auth` schema and the code that gives an app its own database
([ADR 0015](https://github.com/vindotski/spotcraft/blob/main/docs/decisions/0015-shared-postgres.md)).
In the workspace, Node runs the TypeScript source through the `spotcraft-source` export condition
(`node --conditions=spotcraft-source`, `customConditions` in `tsconfig.json`). Anything that installs the
kit into `node_modules`, like the agent's image, uses the build: `pnpm --filter @spotcraft/kit
build` writes JavaScript, type declarations and the migrations to `dist/`.

```bash
npm install @spotcraft/kit                  # see "Versions" below
npm install --save-dev spotcraft            # the local stack: npx spotcraft dev start
```

## Versions

The kit has its own version and [changelog](CHANGELOG.md), separate from Spotcraft's
([ADR 0027](../../docs/decisions/0027-kit-version.md)). What it needs from the server is its
`auth` schema: Spotcraft migrates every app database with the kit it ships, and this kit checks
on first use that the schema is at least `AUTH_SCHEMA_VERSION`. A kit release that raises it says
in the changelog which Spotcraft version it needs; upgrade Spotcraft first, then the kit.

The step-by-step guide for a SvelteKit app, locally and deployed, is
[Guest accounts with the backend kit](https://github.com/vindotski/spotcraft/blob/main/docs/guides/backend-kit.md).

## Guests

```ts
// src/lib/server/backend.ts (server code only)
import { backendFromEnv } from '@spotcraft/kit'

export const backend = backendFromEnv() // DATABASE_URL, AUTH_SECRET, PUBLIC_URL
```

```ts
// reading (GET): the visitor's guest if they have one; never creates one
const { guest, headers } = await backend.currentGuest(request) // guest: Guest | null

// writing (a form post): their guest, created if they have none yet
const { guest, headers } = await backend.guest(request)

// …use guest.id as the owner of the app's rows, and send `headers` with the response:
// they set or refresh the session cookie.
```

Create guests only on writes. If every request created one, a first visit would make several
(the page and its parallel requests, such as `/favicon.ico`, all arrive before the cookie
exists), and so would every crawler.

- **Server-only.** No auth routes are mounted and there is no client SDK. The browser only
  carries the session cookie (`httpOnly`, `SameSite=Lax`, `Secure` on https, path `/`).
  Bundling the kit for the browser fails: its `browser` export has nothing in it and throws.
- **Sessions last a year** and renew daily on use, so a returning visitor keeps their data.
  Clearing cookies or switching device starts a new guest; until sign-up exists, the old data
  can't be reached again.
- **New guests are limited** to 30 per client address per 10 minutes (`guestLimit`), in
  memory. Over the limit, `guest()` throws `GuestLimitError` (`status` 429,
  `retryAfterSeconds`). Returning guests are never limited. Answer 429 with `Retry-After` when
  `isGuestLimitError(error)` is true: it checks the shape, so it also works when the server is
  bundled more than once and `instanceof` fails.
- **The client address** is the last X-Forwarded-For entry, the one Spotcraft's Caddy sets
  (`clientAddress(request, fallback)`), or `'unknown'` without the header. An IPv6 address
  counts as its /64 (`network()`), since one home or phone may use any address in it. Pass
  `guest(request, { clientAddress })` to choose it yourself: always do when the app runs behind
  another proxy, or none, where a client could send any X-Forwarded-For.
- **The schema version is checked** on first use. Against an older `auth` schema, `guest()`
  fails with "Upgrade Spotcraft (locally: spotcraft dev migrate)". `backend.check()` runs the
  same check at once, and names a database it can't reach: call it when the server starts, so
  a wrong database fails the deploy's health check rather than the first save.
- `backendFromEnv` stops the app at start with the variable's name if `DATABASE_URL`,
  `AUTH_SECRET` (32+ characters) or `PUBLIC_URL` (https, or http on localhost) is wrong.
  `createBackend({ databaseUrl, baseURL, secret, guestLimit })` takes them directly.
- `backend.db` is Drizzle over the same database, for the app's own tables. `close()` ends the
  connections.

Under the hood it is Better Auth with only its anonymous plugin, telemetry off. Guests get the
name "Anonymous" and a placeholder email (`…@anonymous.placeholder.invalid`); Postgres
generates their `uuid` ids.

## Exports

| Export             | What                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `.`                | `createBackend`, `backendFromEnv`, the guest limit's error, client addresses, `auth` tables |
| `./migrate`        | `migrateApp`, `migrationsFromFiles`: the app's own migrations                               |
| `./nuxt`           | `guestMiddleware`, `startup`, `prepare`, `healthResponse` for Nuxt 4                        |
| `./tanstack-start` | `guestHelpers`, `startup`, `prepare`, `healthResponse` for TanStack Start                   |
| `./schema`         | Drizzle definitions of the `auth` tables, the SQL migrations, the version                   |
| `./provision`      | `provision`, `purge`, `migrate`, `authSchemaVersion`, `appDatabaseName`                     |

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

## Start and health

`prepare(backend, { migrations, adoptDrizzle, after })` gets the database ready: `check()`,
then the app's migrations, then its own `after` step. It runs once per backend; every caller
waits for the same run, and a failure is tried again by the next caller.

`healthResponse(backend)` is the answer to a health check: 200 `{"ok":true}` once the database
answers, else 503, with the reason only in the log. It waits for a `prepare` under way and fails
while the last one failed, so a deploy goes live only after the migrations ran.

## Framework adapters

The guest, the start check and the health route, wired for a framework. They are functions the
app calls from its own files, because Nitro replaces `import.meta.dev` and
`import.meta.prerender` only in the app's code.

- **`@spotcraft/kit/nuxt`**, for Nuxt 4 (Nitro 2, h3 1). It imports nothing from Nuxt.
  - `guestMiddleware(backend)` puts the guest on `event.context.guest`, creating one only on
    writes, sends the cookie, skips assets and answers the guest limit with 429.
  - Guide: [Guest accounts in Nuxt](https://github.com/vindotski/spotcraft/blob/main/docs/guides/kit-nuxt.md).
- **`@spotcraft/kit/tanstack-start`**, for TanStack Start on React. It imports
  `@tanstack/react-start/server`, an optional peer dependency.
  - `guestHelpers(backend)` gives `currentGuestId()` and `guestId()` for server code, which
    send the cookie and `Cache-Control: private, no-store`.
  - Guide: [Guest accounts in TanStack Start](https://github.com/vindotski/spotcraft/blob/main/docs/guides/kit-tanstack-start.md).
- Both have `startup(nitroApp, backend, options)` for a Nitro plugin: `prepare`, then exit the
  process if it fails, so the deploy fails and the old version keeps serving. It closes the
  connections when the server stops.

The adapters are tested on the framework's own code: h3 1 for Nuxt, Start's request scope for
TanStack Start.

## The app's migrations

`@spotcraft/kit/migrate` runs the app's own migrations, in its database's `public`
([ADR 0031](../../docs/decisions/0031-kit-app-glue.md)). Run it when the server starts, after
`backend.check()`:

```ts
import { migrateApp, migrationsFromFiles } from '@spotcraft/kit/migrate'

// From SQL files, e.g. what `drizzle-kit generate` writes (0000_init.sql, …), read from a
// folder or from server assets. Files not ending in .sql are left out.
const migrations = migrationsFromFiles(files) // [{ name, sql }] → [{ version, name, sql }]
await migrateApp(backend.db, migrations, { adoptDrizzle: true })
```

- Migrations are `{ version, name, sql }`, numbered 1, 2, 3…, with lower-case snake_case
  names. `migrationsFromFiles` sorts the files by name and numbers them from 1.
- The new ones run in **one transaction**, under an advisory lock, so two copies of the app
  starting together wait for each other. A migration waits at most 5 s for a table lock, then
  fails, rather than hold every request behind it. A failure rolls back the whole run and
  names the migration.
- Applied migrations are recorded in `public.app_migrations` (version, name, time).
- It **stops** when a migration is missing below the newest applied one (one added out of
  order), when an applied version now has another name (a file put in the middle), or when the
  database has a version the app doesn't know (an older image against a newer database). New
  migrations go at the end.
- **`adoptDrizzle: true`** takes over from Drizzle's migrator, once. When `app_migrations` is
  empty and `drizzle.__drizzle_migrations` has N rows, the first N migrations count as applied,
  as long as each file's SHA-256 is the hash Drizzle stored. Drizzle's table is then left as it
  is.
- **Migrations only add.** During a release the old and the new version run against the same
  database for a few seconds ([ADR 0028](../../docs/decisions/0028-zero-downtime-deploys.md)).

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
Postgres image as the server).
