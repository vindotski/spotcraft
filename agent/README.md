# @spotcraft/agent

Fastify service on the **apps server** that deploys apps when the dashboard asks. It listens
on the private network only, answers only the addresses in `AGENT_ALLOWED_IPS` (plus its own
loopback, for the health check), and requires a bearer token on every route but `/health`.

The files it writes are the only record of which apps exist:

```
/opt/spotcraft/apps/<name>/app.json      settings sent by the dashboard
/opt/spotcraft/apps/<name>/compose.yaml  generated Compose file (JSON, valid YAML)
/opt/spotcraft/apps/<name>/secrets.json  generated database password (mode 600, never returned)
/opt/spotcraft/sites/<name>.caddy        generated Caddy site block
```

## API

| Method | Path               | What                                                       |
| ------ | ------------------ | ---------------------------------------------------------- |
| GET    | `/health`          | `{ ok: true }`, no token needed                            |
| GET    | `/apps`            | every app's settings plus `state`, `health`, `status`      |
| GET    | `/apps/:name`      | one app, or 404                                            |
| PUT    | `/apps/:name`      | create or update, then deploy; returns the app with status |
| DELETE | `/apps/:name`      | stop and remove the app and its site; 204, or 404          |
|        |                    | `?purge=true` also deletes its database and role           |
| GET    | `/apps/:name/logs` | last `?tail=` lines (default 200, max 5000), plain text    |

`PUT` body (unknown fields are rejected):

| Field      | Default | Rule                                                      |
| ---------- | ------- | --------------------------------------------------------- |
| `image`    | —       | repository, e.g. `vindotski/tagtape` or `ghcr.io/org/app` |
| `tag`      | —       | Docker tag, e.g. `2.0.0`                                  |
| `domain`   | —       | lower-case domain; `www.` redirects to it                 |
| `port`     | `3000`  | port the app listens on inside its container              |
| `env`      | `{}`    | environment variables (`$` is kept literal)               |
| `memory`   | `512m`  | memory limit, `<n>m` or `<n>g`                            |
| `cpus`     | `1`     | CPU limit                                                 |
| `readOnly` | `true`  | read-only root filesystem with a 64 MB writable `/tmp`    |
| `database` | `false` | its own Postgres database, given to it as `DATABASE_URL`  |

App names: lower-case letters, digits and dashes, 2–32 characters; `caddy`, `agent`,
`node-exporter`, `cadvisor` and `postgres` are reserved. A domain can belong to one app only.

Leaving out `database` in an update keeps the app's current setting (a new app gets none), so
an older dashboard never takes a database away. With `database: true`, the app can't set
`DATABASE_URL` itself; without it, it may point `DATABASE_URL` anywhere.

## Deploying

`PUT` writes the files, then runs `docker compose pull`, `docker compose up -d --wait`
(waits up to 120 s for the container to run, and to be healthy if the image has a healthcheck)
and reloads Caddy. If any step fails, the previous version's files are restored and started
again (a new app is removed), and the response carries the error and the command output.
Changes run one at a time.

A `www.` site redirecting to the domain is added only for root domains (two labels, e.g.
`tagtape.app`); subdomains get none, so Caddy never requests certificates for unused names.

Every app container gets: no Linux capabilities, `no-new-privileges`, memory/CPU/pids
limits, rotated logs (3 × 10 MB), and the `spotcraft-edge` network, where Caddy reaches it as
`app-<name>`.

## App databases

With `database: true`, a deploy first prepares the app's own role and database on the apps
server's Postgres (`app_<name>`, with dashes as underscores), using
[`@spotcraft/kit/provision`](../packages/kit/README.md). Only then are the files written, so a
database that can't be prepared changes nothing (the error and Postgres's message come back
as a 502). The password is generated on the first deploy and kept in `secrets.json`. The app
gets `DATABASE_URL=postgres://app_<name>:…@postgres:5432/app_<name>`; it reaches Postgres on
`spotcraft-edge`, and the agent reaches it on the internal `db` network.

Removing an app keeps its database (and the data in it). `DELETE ?purge=true` drops the
database and its role after the app is removed. To delete the database of an app that was
already removed, add it again and remove it with `?purge=true`. Turning `database` off keeps the
database too; the app only stops getting `DATABASE_URL`.

When the agent starts, it brings every app database up to date: role settings, grants and the
`auth` migrations of the kit it was built with. Postgres may still be starting, so failures
are retried every 5 seconds for 3 minutes and logged.

Without `POSTGRES_URL`, the agent runs as before, and asking for a database returns 409.

## Settings

| Env               | Default                  | Meaning                               |
| ----------------- | ------------------------ | ------------------------------------- |
| `AGENT_TOKEN`     | —                        | required, at least 32 characters      |
| `HOST`            | `127.0.0.1`              | bind address                          |
| `PORT`            | `4000`                   | listen port                           |
| `DATA_DIR`        | `/opt/spotcraft`         | holds `apps/` and `sites/`            |
| `CADDY_CONTAINER` | `spotcraft-apps-caddy-1` | container reloaded after site changes |
| `POSTGRES_URL`    | —                        | the agent's Postgres role (optional)  |
| `LOG_LEVEL`       | `info`                   | log level                             |

The image is distroless Node 26 (no shell or package manager) plus the static Docker CLI and
Compose plugin. It runs as uid 1000 and reaches Docker through the socket's group (`group_add`
with `DOCKER_GID`); the Docker CLI keeps its config in `/tmp` so the root filesystem can be
read-only. Mounting the Docker socket still makes the agent
equivalent to root on the server; the private-network binding and the token protect it.

The workspace runs the kit's TypeScript source (the `source` export condition, set in the
`dev` and `test` scripts and in `tsconfig.json`). The image ships the kit's built JavaScript,
because Node won't run TypeScript from `node_modules`.

```sh
pnpm --filter @spotcraft/agent test        # node:test; the database test needs KIT_TEST_POSTGRES_URL
pnpm --filter @spotcraft/agent typecheck
docker build -f agent/Dockerfile .         # from the repository root
```
