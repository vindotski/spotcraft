# spotcraft

The `spotcraft` command. For now it has one job: `spotcraft dev` runs, on your machine, the same
Postgres and app database setup an app gets on a Spotcraft apps server
([ADR 0017](https://github.com/vindotski/spotcraft/blob/main/docs/decisions/0017-local-stack.md)). It needs Docker.

```bash
npm install --save-dev spotcraft   # same version as the Spotcraft you deploy to
npx spotcraft dev start            # start the local Postgres and set up this app's database
npx spotcraft dev env --write      # add DATABASE_URL and AUTH_SECRET to .env (only if missing)
```

| Command             | What                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| `dev start`         | starts the local Postgres if needed, sets up this app's database, prints its settings |
| `dev stop`          | stops the local Postgres; the data stays                                              |
| `dev status`        | whether it runs, and this app's `auth` schema version                                 |
| `dev env [--write]` | prints `DATABASE_URL` and `AUTH_SECRET`; `--write` adds missing ones to `.env`        |
| `dev reset [--yes]` | deletes this app's database and creates it empty again (asks first)                   |
| `dev migrate`       | brings this app's database up to date after upgrading the CLI                         |

The app name comes from `--name`, or from the `name` in `package.json` made into an app name
(`@acme/Blog_API` → `blog-api`). Its database is `app_<name>`, with dashes as underscores.

## Same as the server

- **One Postgres for every app on the machine.** It's a Compose project, `spotcraft-dev`, with
  the data in the `spotcraft-dev_data` volume. Each app gets its own role and database,
  created with the kit's `provision`, the same code the agent uses. So one app can't open
  another's database here either.
- **The same image and login rules** as the apps server: the pinned Postgres image, and the
  superuser only over the container's socket. **The same admin role**: `spotcraft_agent`, set up
  with the deploy script's SQL. Tests fail if the CLI's copies of the image, the rules or that
  SQL drift from `infra/`.
- **The same `auth` schema**: the CLI's version matches the Spotcraft it deploys to (one
  version for the project).

## Local only

Postgres listens on `127.0.0.1:54340` only. The port isn't 54322, which Supabase uses. The
passwords are fixed (`local-<name>-password` for an app), so `DATABASE_URL` stays the same
across runs and in `.env`. That's fine for throwaway data on your own machine and nowhere else.
`AUTH_SECRET` is random; `env --write` keeps the one already in `.env`.

To remove everything: `docker compose -p spotcraft-dev down -v`.

## Developing

In the workspace, run it from source with `pnpm --filter spotcraft spotcraft dev …`. Note
that pnpm runs it in `packages/cli`, so pass `--name`. `pnpm --filter spotcraft build`
writes `dist/` (the `spotcraft` bin); it uses the kit's build, so build the kit first.
