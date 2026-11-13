# Server

Everything Spotcraft runs, on one server ([ADR 0026](../../docs/decisions/0026-one-server.md)),
from `/opt/spotcraft` with Docker Compose.

| Service           | Reachable from           | Purpose                                         |
| ----------------- | ------------------------ | ----------------------------------------------- |
| `caddy`           | public 80/443            | HTTPS, the dashboard and every app's site block |
| `cloudflared`     | outbound only            | with `EDGE=cloudflare`: the tunnel to Caddy     |
| `agent`           | `control` network :4000  | deploys apps; answers only the dashboard        |
| `dashboard`       | via Caddy                | SvelteKit app; no database, asks the agent      |
| `postgres`        | `edge` and `db` networks | databases for hosted apps                       |
| `victoriametrics` | `web` network            | metrics storage (90 days)                       |
| `vmagent`         | `web` network            | scrapes the exporters, runs the probes          |
| `blackbox`        | `web` network            | HTTP uptime probes of each app's public URLs    |
| `node-exporter`   | `web` network :9100      | host metrics                                    |
| `cadvisor`        | `web` network :8080      | per-container metrics                           |

Only Caddy is published on host ports. Files: `compose.yaml`, `Caddyfile`, `pg_hba.conf`,
`scrape.yaml` (vmagent targets), `blackbox.yml` (probe modules) and `.env.example` (the deploy
writes `.env`). A fresh server is prepared by [`../cloud-init.yaml`](../cloud-init.yaml).

The Compose project is called `spotcraft-apps`, the name it had when apps and the dashboard
ran on separate servers, so the existing volumes and container names carry over.

## Networks

| Network                   | Members                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `edge` (`spotcraft-edge`) | Caddy, Postgres, every hosted app                                           |
| `web` (`10.255.254.0/27`) | Caddy, cloudflared (fixed `10.255.254.2`), the dashboard and the monitoring |
| `control` (internal)      | the dashboard (fixed `10.255.255.2`) and the agent                          |
| `db` (internal)           | the agent and Postgres                                                      |
| `default`                 | the agent alone, for its calls to the Cloudflare API                        |

Hosted apps reach only Caddy and Postgres. The agent answers only `10.255.255.2`
(`AGENT_ALLOWED_IPS`), with the bearer token. On `web` and `control`, other services get
addresses from an `ip_range` that excludes the fixed ones, so none can take them first. `edge`
has IPv6 on and carries Caddy's published ports, so Caddy sees IPv6 visitors' real addresses.

App names can't shadow the server's services on these networks: the agent reserves `caddy`,
`cloudflared`, `agent`, `dashboard`, `postgres`, `victoriametrics`, `vmagent`, `blackbox`,
`node-exporter` and `cadvisor`, and refuses an app host equal to `DASHBOARD_DOMAIN`.

## Hardening

Every service runs without Linux capabilities (Caddy keeps `NET_BIND_SERVICE`), with
`no-new-privileges`, a read-only root filesystem where the software allows, memory and
process limits, and health checks. The agent and the dashboard run from the same `spotcraft`
image ([ADR 0025](../../docs/decisions/0025-one-image.md)); only the agent's container mounts
the Docker socket. cAdvisor gets the Docker and containerd sockets read-only to name containers
and read their Compose labels; the dashboard finds each app's metrics by
`com.docker.compose.project`. cAdvisor collects only what the dashboard reads: Docker
containers' CPU and memory, every 30 seconds, with that one label (about a sixth of its default
series).

## Caddy

Caddy serves the dashboard at `DASHBOARD_DOMAIN` (HSTS, security headers, 1 MB request bodies)
and imports one site block per hosted app from `sites/`, written by the agent. It passes each
visitor's address as `X-Forwarded-For` (the dashboard's login lockout keys on it) and trusts
`CF-Connecting-IP` only from `CADDY_TRUSTED_PROXIES` (loopback by default; cloudflared's
`10.255.254.2` behind a Cloudflare Tunnel). The dashboard's site answers only peers in
`DASHBOARD_PEERS`: anyone in direct mode, only cloudflared behind a tunnel, so nothing on the
server (a hosted app, say) can reach it around Cloudflare Access, the WAF or the login rate
limit. With `APPS_DOMAIN`, the agent serves every app at
`<name>.<APPS_DOMAIN>`; point a wildcard record at this server.

Behind Cloudflare (`EDGE=cloudflare`, ADR 0021), the deploy adds to `.env`:
`COMPOSE_PROFILES=cloudflare` (starts `cloudflared` with `CLOUDFLARE_TUNNEL_TOKEN`),
`PUBLIC_BIND=127.0.0.1` (Caddy's ports on loopback only), `CADDY_TRUSTED_PROXIES` and
`DASHBOARD_PEERS` set to `10.255.254.2/32`, and `DASHBOARD_SCHEME=http://`. Caddy and the agent's site blocks then serve plain HTTP to
`cloudflared`; Cloudflare holds the certificates.

## Monitoring

vmagent scrapes node-exporter and cAdvisor every 30 seconds and runs uptime probes of every
hosted app's public URLs through blackbox; the dashboard writes those targets (`probes`
volume) whenever the app list changes. Probes use blackbox's `http_2xx` module. For an app
behind Cloudflare Access, the dashboard labels its targets `module=http_access`: that module
expects a 302 to `<team>.cloudflareaccess.com`, so the probe shows Cloudflare and Access are up,
not the app behind the sign-in. Logs are read through the agent (`docker logs`).

The monitoring runs on the server it watches: if the server is down, so is the dashboard. Use
an external uptime check (any free one) on the dashboard's URL to hear about that.

## Postgres

Postgres 18 ([ADR 0015](../../docs/decisions/0015-shared-postgres.md)) is reachable as
`postgres` on `spotcraft-edge`, where hosted apps are, and on the internal `db` network for the
agent. It is never published on a host port. It runs as its image's own user (999) with a
read-only root and a 1 GB memory limit, tuned for a small server, and keeps its data in the
`postgres_data` volume. Logins (`pg_hba.conf`):

- the superuser `postgres` only over the container's local socket;
- every other role with a password (SCRAM).

The deploy script manages the agent's role, `spotcraft_agent`, on every deploy: it creates the
role or updates its password from `POSTGRES_AGENT_PASSWORD`. The role may create databases and
roles but is not a superuser. It may `SET ROLE` to roles it creates (`createrole_self_grant`),
which Postgres requires to make them a database's owner. The built-in `postgres` and
`template1` databases are closed to everyone else. The superuser's password is generated on the
first deploy and kept in `.env` (`POSTGRES_SUPERUSER_PASSWORD`); Postgres only uses it once,
when it creates its data directory.

## Memory

Spotcraft's own limits add up to about 4.2 GB: Caddy 512 MB, cloudflared 128 MB, agent 256 MB,
dashboard 512 MB, Postgres 1 GB, VictoriaMetrics 1 GB, vmagent 256 MB, blackbox 128 MB,
node-exporter 128 MB, cAdvisor 256 MB. Limits are ceilings, not use; on a `cax21` (8 GB) the
rest is for hosted apps.
