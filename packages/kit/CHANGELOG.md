# Changelog: @spotcraft/kit

All notable changes to `@spotcraft/kit` are documented in this file. The kit has its own
[Semantic Version](https://semver.org/spec/v2.0.0.html), separate from Spotcraft's
([ADR 0027](../../docs/decisions/0027-kit-version.md)); it is released with `kit-vX.Y.Z` tags.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Every entry that raises the `auth` schema version (`AUTH_SCHEMA_VERSION`) says which Spotcraft
version it needs: the server migrates app databases with the kit it ships, and the kit refuses
to run against an older schema.

## [Unreleased]

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

[Unreleased]: https://github.com/vindotski/spotcraft/compare/kit-v0.3.1...HEAD
[0.3.1]: https://github.com/vindotski/spotcraft/compare/kit-v0.3.0...kit-v0.3.1
[0.3.0]: https://github.com/vindotski/spotcraft/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vindotski/spotcraft/releases/tag/v0.2.0
