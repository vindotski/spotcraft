---
title: A server-only backend kit, starting with guest accounts
number: 16
status: accepted
implementation: done
date: 2026-11-08
supersedes: []
superseded_by: []
notes: "Sign-up, sign-in, email, banning and guest pruning come later, each with its own record. Confirmed while building (Better Auth 1.7): guests get the name Anonymous and a unique placeholder email; generateId: uuid lets Postgres generate the ids; guests are created and read server-side with auth.api and returnHeaders. Also added while building: currentGuest(request) reads the guest without creating one, and apps create guests only on writes. Otherwise a first visit made several guests (the page and its parallel requests, such as the favicon, arrive before the cookie exists), and so did every crawler. For later: when a guest signs up, Better Auth creates a new user, calls onLinkAccount with both, then deletes the guest, so moving their data will use that hook."
---

# A server-only backend kit, starting with guest accounts

## Context

Every app needs the same backend pieces, starting with knowing who a visitor is, and hosted auth
services charge for that past their free tiers. The first need is **guest accounts**: a visitor
uses an app without signing up, and their data is still there when they come back. Sign-up comes
later, and guests must be able to keep their data when it does.

## Decision

- **A library, not a service.** `packages/kit`, published to npm with the project's version. Apps
  import it; Spotcraft runs no auth service.
- **Server-only, for SSR apps.** The browser never talks to auth or the database. It only holds an
  `httpOnly` session cookie that the app's server sets in its normal responses.
  - No auth HTTP routes are mounted and there is no client SDK. The kit uses Better Auth only from
    server code.
  - Cookies are `httpOnly`, `Secure` (except on `localhost`), `SameSite=Lax`, path `/`.
  - The package's `browser` export throws, so a client bundle that imports the kit fails to build.
- **Guests on Better Auth's anonymous plugin.** `createBackend({ databaseUrl, baseURL, secret })`
  returns:
  - `db`, Drizzle over Postgres, where the app adds its own tables;
  - `guest(request, { clientAddress })`, which returns the current guest or creates one with a
    session that lasts about a year and renews on use.

  The kit rate-limits guest creation per client address itself, because it mounts none of Better
  Auth's routes, where Better Auth's own limiter applies.
- **Spotcraft owns the `auth` schema**, as Supabase does:
  - The kit holds the migrations (`/schema`) and the provisioning code (`/provision`).
  - The agent applies the migrations on the server and the CLI applies them locally (ADR 0017).
    `migrate()` applies them to any other Postgres.
  - The provisioning role owns `auth`. The app's role can read and write its rows and reference
    `auth.users`, but can't change its structure. The app owns `public` and its own migrations.
  - Migrations are tracked in `auth.kit_migrations` and only ever add. Kit X.Y needs Spotcraft X.Y
    or later, and the kit refuses to start against an older schema.
- **Tables**: `auth.users`, `auth.sessions`, `auth.accounts` and `auth.verifications`, with plural
  snake_case names, `uuid` ids and `timestamptz` times. Guests and registered users share
  `auth.users` (`is_anonymous`), so sign-up later needs no table change.
- **App data lives in the app's tables**, keyed by
  `user_id uuid references auth.users(id) on delete cascade`, never as extra columns on
  `auth.users`. Deleting a user removes their data.

## Consequences

- A guest who clears cookies or switches device loses access to their data until sign-up exists.
- Client-side-only apps can't use the kit.
- The kit's tables follow Better Auth's model; Better Auth upgrades that change it need an added
  migration.
- To confirm while building, and amend here if wrong:
  - guests get a placeholder email (`email` is required);
  - `uuid` ids work together with the renamed tables;
  - a guest can be created server-side with the cookie returned.
