---
title: The kit holds the server glue every app repeated
number: 31
status: accepted
implementation: done
date: 2026-11-14
supersedes: [16]
superseded_by: []
notes: "Built in kit 0.4.0: clientAddress and network, isGuestLimitError, backend.check(), @spotcraft/kit/migrate (migrateApp, migrationsFromFiles, adoptDrizzle), prepare and healthResponse, and the Nuxt and TanStack Start adapters. Found while building: Nitro 2 doesn't wait for an async plugin before serving, so healthResponse waits for prepare; the Nuxt adapter imports nothing from h3 and answers the guest limit itself, since h3 logs a thrown error as unhandled."
---

# The kit holds the server glue every app repeated

## Context

ADR 0016 made the kit framework-neutral: a Web `Request` goes in, `Headers` come out, and the
app passes `clientAddress` to `guest()`. It left the app's own migrations to the app. This
record replaces those two rules of ADR 0016; the rest of it stands.

The two apps on Spotcraft, on Nuxt and on TanStack Start, each wrote the same code around the
kit, and got parts of it differently:
- reading the client address from the X-Forwarded-For entry Spotcraft's Caddy adds, with an
  IPv6 address counted as its /64 (only one of them did);
- spotting the guest limit's error by its shape, since `instanceof` fails across bundles;
- a check at start that stops the server when the database is wrong;
- a runner for the app's own SQL migrations, with an advisory lock and an ordering check, or
  Drizzle's folder migrator, which needs a folder at run time.

## Decision

- **Client address.** `guest(request)` no longer needs `clientAddress`. Without it, the kit
  takes the last X-Forwarded-For entry, which Spotcraft's Caddy sets, and `'unknown'` without
  one. Any address, passed in or read, counts as its /64 if it is IPv6.
  `clientAddress(request, fallback)` and `network(address)` are exported for adapters.
- **`isGuestLimitError(error)`** checks the shape (`status` 429 and a finite
  `retryAfterSeconds`), so it works across copies of the kit.
- **`backend.check()`** connects and checks the `auth` schema version, with an error that
  names the problem. Apps call it at start.
- **`@spotcraft/kit/migrate`** runs an app's own migrations, in its database's `public`:
  - `migrateApp(db, migrations, { adoptDrizzle })` takes `{ version, name, sql }`, numbered
    1, 2, 3… It applies the new ones in one transaction under an advisory lock, with a 5 s
    `lock_timeout`, and records them in `public.app_migrations`.
  - It refuses to run when a migration is missing below the newest applied one, when an
    applied version now has another name, or when the database is newer than the app.
  - `migrationsFromFiles(files)` sorts `.sql` files by name and numbers them from 1, so
    `drizzle-kit generate`'s files work as they are, read from a folder or from server assets.
  - `adoptDrizzle` takes over from Drizzle's migrator once: when `app_migrations` is empty and
    `drizzle.__drizzle_migrations` has N rows, the first N migrations count as applied, if each
    file's SHA-256 matches the hash Drizzle stored.
  - Migrations still only add: during a release two versions of the app run against one
    database (ADR 0028).
- **Framework adapters** as optional subpath exports with optional peer dependencies:
  `@spotcraft/kit/nuxt` and `@spotcraft/kit/tanstack-start`. They are functions, not
  ready-made plugins: Nitro replaces `import.meta.dev` and `import.meta.prerender` only in the
  app's code, so the app keeps a short plugin that calls the kit.

## Consequences

- Apps on Spotcraft drop their own copies of this code, and get the same IPv6 grouping.
- An app hosted behind another proxy, or none, must pass `clientAddress` itself: without it,
  a client could put any address in X-Forwarded-For and dodge the guest limit.
- `migrateApp` uses the same lock number and `app_migrations` table as the runner vinskiano
  had, so it takes over with nothing to change in the database.
- Inserting a file between applied migrations now stops the app at start, instead of renumbering
  what ran. New migration files go at the end.
- The kit has more to keep working: each adapter is tested against the framework versions its
  peer range names.
