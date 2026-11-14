# Changelog: @spotcraft/kit

All notable changes to `@spotcraft/kit` are documented in this file. The kit has its own
[Semantic Version](https://semver.org/spec/v2.0.0.html), separate from Spotcraft's
([ADR 0027](../../docs/decisions/0027-kit-version.md)); it is released with `kit-vX.Y.Z` tags.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Every entry that raises the `auth` schema version (`AUTH_SCHEMA_VERSION`) says which Spotcraft
version it needs: the server migrates app databases with the kit it ships, and the kit refuses
to run against an older schema.

## [Unreleased]

## [0.4.0] - 2026-11-14

The server glue every app wrote around the kit, now in it
([ADR 0031](../../docs/decisions/0031-kit-app-glue.md)). No change to the `auth` schema (still
version 1); works with every Spotcraft from 0.2.0.

### Added

- `@spotcraft/kit/migrate`: `migrateApp` runs the app's own migrations in one transaction,
  under an advisory lock and a 5 s lock timeout, recorded in `public.app_migrations`. It stops
  on a migration added out of order or renamed, and on a database newer than the app.
  `migrationsFromFiles` turns SQL files (such as `drizzle-kit generate`'s) into migrations, and
  `adoptDrizzle` takes over a database Drizzle's migrator managed.
- `backend.check()` checks the database and its `auth` schema at once, for a check at start.
- `isGuestLimitError(error)`, which works across bundles where `instanceof` fails.
- `clientAddress(request, fallback)` and `network(address)`.
- `prepare(backend, options)` checks the database, migrates and runs the app's own step, once
  per backend. `healthResponse(backend)` answers a health check, and waits for `prepare`.
- `@spotcraft/kit/nuxt` (Nuxt 4): `guestMiddleware`, `startup` for a Nitro plugin, and the
  above. It imports nothing from Nuxt.
- `@spotcraft/kit/tanstack-start`: `guestHelpers` (`currentGuestId`, `guestId`), `startup` and
  the above. `@tanstack/react-start` is an optional peer dependency.
- Guides for [Nuxt](../../docs/guides/kit-nuxt.md) and
  [TanStack Start](../../docs/guides/kit-tanstack-start.md).

### Changed

- `guest(request)` takes the client address from the last X-Forwarded-For entry, which
  Spotcraft's Caddy sets, when `clientAddress` isn't passed.
- The backend logs a Postgres connection that breaks while idle, instead of crashing the
  server on the pool's unhandled `error` event.
- Every client address the guest limit counts, passed in or read, counts as its /64 when it is
  IPv6. One phone could make guests from many addresses before.

## [0.3.1] - 2026-11-13

### Security

- `provision` and `migrate` pin `search_path` to `pg_catalog, auth` on their connections, so a
  schema an app creates in its own database can't shadow what the migrations and grants use.
  No change to the `auth` schema (still version 1); works with every Spotcraft from 0.2.0.

## [0.3.0] - 2026-11-13

Released together with Spotcraft 0.3.0, at the same version; no changes to the kit's code.
`auth` schema version 1, which every Spotcraft from 0.2.0 provides.

## [0.2.0] - 2026-11-08

The first release, together with Spotcraft 0.2.0: guest accounts for server-rendered apps on
Better Auth, server-only (an httpOnly session cookie, no auth routes), with a guest limit per
client address and a check of the `auth` schema version; `currentGuest` reads without creating.
The `./schema` export (the `auth` tables and migrations) and `./provision` (an app's database
and role). `auth` schema version 1; needs Spotcraft 0.2.0 or later.

[Unreleased]: https://github.com/vindotski/spotcraft/compare/kit-v0.4.0...HEAD
[0.4.0]: https://github.com/vindotski/spotcraft/compare/kit-v0.3.1...kit-v0.4.0
[0.3.1]: https://github.com/vindotski/spotcraft/compare/kit-v0.3.0...kit-v0.3.1
[0.3.0]: https://github.com/vindotski/spotcraft/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vindotski/spotcraft/releases/tag/v0.2.0
