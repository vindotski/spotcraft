---
title: One Postgres on the apps server, a database per app
number: 15
status: accepted
implementation: done
date: 2026-11-08
supersedes: []
superseded_by: []
notes: "First stateful service for hosted apps; backups were decided in ADR 0030. As built, the app's database password is kept in apps/<name>/secrets.json (mode 600) rather than app.json, so the agent's API never returns it."
---

# One Postgres on the apps server, a database per app

## Context

Hosted apps are stateless containers (ADR 0007), so an app that needs to remember anything,
starting with guest accounts (ADR 0016), has nowhere to keep it. A database per app inside each
app's own stack would multiply memory use and backups by the number of apps; a hosted database
service would add a monthly cost for each.

## Decision

- **One Postgres** runs on the apps server: the official image pinned by digest, a named volume,
  a memory limit and settings for a small server. It sits on `spotcraft-edge` as `postgres` and
  is never published. It is hardened like the other services as far as the image allows.
- **An app asks for a database** with `database: true` in its spec. The agent then creates a role
  `app_<name>` and a database `app_<name>` owned by it, revokes `CONNECT` from `PUBLIC`, applies
  the `auth` schema (ADR 0016), keeps the generated password in `app.json`, and gives the app
  `DATABASE_URL`. Doing this again changes nothing.
- **The agent connects as `spotcraft_agent`**, which may create databases and roles but is not a
  superuser. Its password, `POSTGRES_AGENT_PASSWORD`, lives in `.env` and the deploy
  environment.
- **The provisioning code is shared** with the local stack (ADR 0017), so a database looks the same
  on a laptop as on the server.
- Each app role has a connection limit and a `statement_timeout`, so one app can't starve the
  others.
- When the agent starts, it brings every app database to the latest `auth` migration.
- Deleting an app keeps its database unless the request asks to purge it; the dashboard confirms
  a purge a second time.

## Consequences

- Apps stay stateless containers; their data lives in one place on the apps server.
- Postgres is a shared failure point: when it is down, every app with a database is down.
- A major Postgres upgrade needs a dump and restore; that procedure gets documented.
- Losing the apps server now loses app data, not only configuration. **Backups are the next
  decision.**
