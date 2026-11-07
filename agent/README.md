# @spotcraft/agent

Fastify service on the **apps server** that deploys apps when the dashboard asks. It listens
on the private network only and requires a bearer token on every route but `/health`.

The files it writes are the only record of which apps exist:

```
/opt/spotcraft/apps/<name>/app.json      settings sent by the dashboard
/opt/spotcraft/apps/<name>/compose.yaml  generated Compose file (JSON, valid YAML)
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

App names: lower-case letters, digits and dashes, 2–32 characters; `caddy`, `agent`,
`node-exporter` and `cadvisor` are reserved. A domain can belong to one app only.

## Deploying

`PUT` writes the files, then runs `docker compose pull`, `docker compose up -d --wait`
(waits up to 120 s for the container to run, and to be healthy if the image has a healthcheck)
and reloads Caddy. If any step fails, the previous version's files are restored and started
again (a new app is removed), and the response carries the error and the command output.
Changes run one at a time.

Every app container gets: no Linux capabilities, `no-new-privileges`, memory/CPU/pids
limits, rotated logs (3 × 10 MB), and the `spotcraft-edge` network, where Caddy reaches it as
`app-<name>`.

## Settings

| Env               | Default                  | Meaning                               |
| ----------------- | ------------------------ | ------------------------------------- |
| `AGENT_TOKEN`     | —                        | required, at least 32 characters      |
| `HOST`            | `127.0.0.1`              | bind address                          |
| `PORT`            | `4000`                   | listen port                           |
| `DATA_DIR`        | `/opt/spotcraft`         | holds `apps/` and `sites/`            |
| `CADDY_CONTAINER` | `spotcraft-apps-caddy-1` | container reloaded after site changes |
| `LOG_LEVEL`       | `info`                   | log level                             |

The image runs as the unprivileged `node` user and reaches Docker through the socket's
group (`group_add` with `DOCKER_GID`). Mounting the Docker socket still makes the agent
equivalent to root on the server; the private-network binding and the token protect it.

```sh
pnpm --filter @spotcraft/agent test        # node:test, no Docker needed
pnpm --filter @spotcraft/agent typecheck
docker build -f agent/Dockerfile .         # from the repository root
```
