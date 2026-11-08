---
title: A local stack that matches the server
number: 17
status: accepted
implementation: done
date: 2026-11-08
supersedes: []
superseded_by: []
notes: "Database and auth only; no Studio-style UI yet. As built, Postgres listens on 127.0.0.1:54340, not 54322, which is Supabase's default local database port."
---

# A local stack that matches the server

## Context

An app using a database (ADR 0015) and the backend kit (ADR 0016) has to run on a developer's
machine with the same database setup and the same `auth` schema it gets when deployed.
Otherwise problems only show up after a deploy.

## Decision

- **A CLI**, `packages/cli`, published to npm as the `spotcraft` command, used from an app's
  repository:
  - `dev start` runs one local Postgres through Docker Compose (project `spotcraft-dev`, a named
    volume, `127.0.0.1:54322` only). It then provisions the app's database and prints
    `DATABASE_URL` and a generated `AUTH_SECRET`.
  - `dev stop` keeps the data; `dev status` and `dev env` show the settings.
  - `dev env --write` adds missing variables to `.env` and overwrites nothing.
  - `dev reset` drops and re-creates the app's database after asking.
  - `dev migrate` applies newer `auth` migrations after an upgrade.
- **Same as the server**: the CLI provisions with the kit's `/provision`, the same code the agent
  uses. Its Postgres image is the one pinned for the apps server, and a test keeps the two equal.
- The app name comes from `--name` or `package.json`. Several apps share the one local Postgres,
  each with its own database, as on the server.
- No Studio-style UI; any Postgres client works with the printed URL.

## Consequences

- Local development needs Docker.
- Local data is throwaway (`dev reset`).
- The CLI's version must match the Spotcraft the app deploys to, like the kit's.
