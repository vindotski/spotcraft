# @spotcraft/agent

Fastify service on the Spotcraft server that deploys apps when the dashboard asks. It is
reachable only on Docker networks (never on a host port), answers only the addresses in `AGENT_ALLOWED_IPS` (plus its own
loopback, for the health check), and requires a bearer token on every route but `/health`.

The files it writes are the only record of which apps exist:

```
/opt/spotcraft/apps/<name>/app.json      settings sent by the dashboard
/opt/spotcraft/apps/<name>/compose.yaml  generated Compose file (JSON, valid YAML)
/opt/spotcraft/apps/<name>/secrets.json  generated database password (mode 600, never returned)
/opt/spotcraft/sites/<name>.caddy        generated Caddy site block
```

## API

| Method | Path                    | What                                                       |
| ------ | ----------------------- | ---------------------------------------------------------- |
| GET    | `/health`               | `{ ok: true }`, no token needed                            |
| GET    | `/settings`             | `{ appsDomain?, edge, dns, access }`: what is set up       |
| GET    | `/apps`                 | settings plus `state`, `health`, `status`, `hostnames`     |
| GET    | `/apps/:name`           | one app, or 404                                            |
| PUT    | `/apps/:name`           | create or update, then deploy; returns the app with status |
| DELETE | `/apps/:name`           | stop and remove the app and its site; 204, or 404          |
|        |                         | `?purge=true` also deletes its database and role           |
| GET    | `/apps/:name/domain`    | custom domain status and records still to create           |
| GET    | `/apps/:name/logs`      | last `?tail=` lines (default 200, max 5000), plain text    |
| GET    | `/apps/:name/users`     | the app's users, newest first (`?limit=`, `?cursor=`)      |
| DELETE | `/apps/:name/users/:id` | delete a user and what the app kept for them; 204, or 404  |

`PUT` body (unknown fields are rejected):

| Field       | Default | Rule                                                      |
| ----------- | ------- | --------------------------------------------------------- |
| `image`     | —       | repository, e.g. `vindotski/tagtape` or `ghcr.io/org/app` |
| `tag`       | —       | Docker tag, e.g. `2.0.0`                                  |
| `domain`    | —       | custom domain; required only without `APPS_DOMAIN`        |
| `port`      | `3000`  | port the app listens on inside its container              |
| `env`       | `{}`    | environment variables (`$` is kept literal)               |
| `memory`    | `512m`  | memory limit, `<n>m` or `<n>g`                            |
| `cpus`      | `1`     | CPU limit                                                 |
| `readOnly`  | `true`  | read-only root filesystem with a 64 MB writable `/tmp`    |
| `database`  | `false` | its own Postgres database, given to it as `DATABASE_URL`  |
| `protected` | `false` | behind Cloudflare Access (needs an Access policy)         |
| `takeOver`  | `false` | deploys may replace a custom domain's foreign DNS records |

`database`, `protected` and `takeOver` keep their current value when left out.

App names: lower-case letters, digits and dashes, 2–32 characters. The names of the server's
own services (`caddy`, `cloudflared`, `agent`, `dashboard`, `postgres`, `victoriametrics`,
`vmagent`, `blackbox`, `node-exporter`, `cadvisor`), since an app's service joins the same
network, plus `www` and `fallback`, are reserved, and so is every name starting with `app-`
(Caddy reaches each app as `app-<name>`). A host can belong to one app only: a custom domain
can't be another app's default host, and no app may use `DASHBOARD_DOMAIN` or a reserved host
of the apps domain such as `fallback.<APPS_DOMAIN>` (409). The apex itself may be an app's.

With `APPS_DOMAIN` set, every app is served at `<name>.<APPS_DOMAIN>` (its default host,
first in `hostnames`) and, if it has one, at its custom domain too (ADR 0021).

Leaving out `database` or `protected` in an update keeps the app's current setting (a new app gets none), so
an older dashboard never takes a database away. With `database: true`, the app can't set
`DATABASE_URL` itself; without it, it may point `DATABASE_URL` anywhere.

## Custom domains through Cloudflare

With `EDGE=cloudflare`, `APPS_DOMAIN` and all four of `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_APPS_ZONE_ID` and `CLOUDFLARE_TUNNEL_ID` (from
`infra/cloudflare`), the agent sets up each app's custom domain itself (ADR 0021). Set without
`EDGE=cloudflare` and `APPS_DOMAIN` (for example ahead of a switch), they are ignored and the
agent logs a notice at startup. A root domain
also gets `www.`.

- **The domain's zone is in the account**: the agent creates a proxied CNAME to the apps tunnel,
  with the comment `spotcraft:<name>`. It refuses (409) if the host already has A, AAAA or CNAME
  records it didn't make, unless the app's `takeOver` setting is on (ADR 0022). Other records such as MX and
  TXT are never touched.
- **Any other domain**: the agent creates a Cloudflare for SaaS custom hostname on the apps zone.
  Its owner adds a CNAME to `<name>.<APPS_DOMAIN>`, plus any TXT records `GET /apps/:name/domain`
  lists. Cloudflare then verifies the domain and issues its certificate.

DNS is set up before anything else in a deploy, and every host is checked before any is
changed. If the deploy then fails, or Cloudflare fails partway, DNS is put back exactly as it
was, including records a take-over replaced. No host may belong to two apps, including the
`www.` a root domain redirects. When the domain changes,
the old one's records go once the new version runs. Removing the app removes its records and
custom hostnames. Without these settings, `GET /apps/:name/domain` only says which records to
create by hand.

With `CLOUDFLARE_ACCESS_POLICY_ID` too (the owners' policy from `infra/cloudflare`), an app with
`protected: true` gets a Cloudflare Access application named `spotcraft:<name>` that covers every
host it answers on. Visitors sign in with a one-time code first. Protection goes on before the new
version takes traffic. If the deploy fails, the previous protection is put back, and removing
the app removes the Access application. Without the policy, `protected: true` returns 409.

## Deploying

Each app's Caddy site depends on `EDGE` and `APPS_DOMAIN`. When the agent starts, it rewrites
any site that doesn't match them and reloads Caddy (retrying while Caddy starts), so switching
modes applies to every app at once. A protected app's new hosts go behind Access first, next to its old ones,
and only once Caddy runs the new sites does Access drop the old hosts. If
Caddy rejects the rewrite, the previous sites are put back. An app left without any address
(no `APPS_DOMAIN` and no domain of its own) gets no site until it has one.

`PUT` writes the files, then runs `docker compose pull`, `docker compose up -d --wait`
(waits up to 120 s for the container to run, and to be healthy if the image has a healthcheck)
and reloads Caddy. If any step fails, the previous version's files are restored and started
again (a new app is removed), and the response carries the error and the command output.
Changes run one at a time.

A `www.` site redirecting to the custom domain is added only for root domains (two labels,
e.g. `tagtape.app`); subdomains get none, so Caddy never requests certificates for unused names.
Caddy passes the visitor's address to the app as `X-Forwarded-For`. With `EDGE=cloudflare`,
site blocks are plain HTTP (`http://host`): Cloudflare terminates TLS and a tunnel delivers
requests to Caddy.

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

## App users

For an app with a database, the agent reads and deletes its users directly in the app's
`auth` tables, which it owns ([ADR 0018](../docs/decisions/0018-user-management.md)). It works
while the app is down.

- `GET /apps/:name/users` returns `{ available, total, users, next }`. Each user has `id`,
  `guest` (no sign-up), `createdAt` and `lastSeen` (their most recently used session, or
  `null`). Pages hold `?limit=` users (default 50, max 200); pass `next` back as `?cursor=` for
  the older ones. `available` is false if the database has no `auth` schema.
- `DELETE /apps/:name/users/:id` (a uuid) deletes the user. Their sessions and the app's own
  rows go with them through their foreign keys.
- An app without a database answers 409; an unknown app, 404.

## Settings

| Env                | Default                  | Meaning                                 |
| ------------------ | ------------------------ | --------------------------------------- |
| `AGENT_TOKEN`      | —                        | required, at least 32 characters        |
| `HOST`             | `127.0.0.1`              | bind address                            |
| `PORT`             | `4000`                   | listen port                             |
| `DATA_DIR`         | `/opt/spotcraft`         | holds `apps/` and `sites/`              |
| `CADDY_CONTAINER`  | `spotcraft-apps-caddy-1` | container reloaded after site changes   |
| `POSTGRES_URL`     | —                        | the agent's Postgres role (optional)    |
| `APPS_DOMAIN`      | —                        | apps get `<name>.<APPS_DOMAIN>`         |
| `DASHBOARD_DOMAIN` | —                        | the dashboard's host; apps can't use it |
| `EDGE`             | `direct`                 | `cloudflare`: sites are plain HTTP      |
| `CLOUDFLARE_*`     | —                        | custom domains, Access (see below)      |
| `LOG_LEVEL`        | `info`                   | log level                               |

The agent runs from the `spotcraft` image (the root `Dockerfile`, shared with the dashboard;
Compose starts it with `working_dir: /app/agent` and `command: ["src/index.ts"]`): distroless
Node 26 (no shell or package manager) plus the static Docker CLI and Compose plugin. It runs as uid 1000 and reaches Docker through the socket's group (`group_add`
with `DOCKER_GID`); the Docker CLI keeps its config in `/tmp` so the root filesystem can be
read-only. Mounting the Docker socket still makes the agent
equivalent to root on the server; the private-network binding and the token protect it.

The workspace runs the kit's TypeScript source (the `spotcraft-source` export condition, set in the
`dev` and `test` scripts and in `tsconfig.json`). The image ships the kit's built JavaScript,
because Node won't run TypeScript from `node_modules`.

```sh
pnpm --filter @spotcraft/agent test        # node:test; the database test needs KIT_TEST_POSTGRES_URL
pnpm --filter @spotcraft/agent typecheck
docker build .                             # the spotcraft image, from the repository root
```
