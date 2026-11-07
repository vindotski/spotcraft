# Spotcraft

Self-hosted deployment for a handful of web apps on your own VPSes. Point it at
Docker images, and it runs them behind HTTPS, monitors them, and shows everything in
one dashboard.

Built for about ten small-to-mid server-rendered apps. Works on any Debian/Ubuntu VPS,
with an optional OpenTofu module for Hetzner Cloud.

> Status: skeleton. Nothing is deployable yet.

## How it fits together

```
                 internet
            ┌───────┴────────┐
        80/443            80/443
   ┌────────▼─────────┐  ┌───▼──────────────────────┐
   │   apps server    │  │        ops server        │
   │  Caddy           │  │  Caddy → dashboard       │
   │  app containers  │  │  VictoriaMetrics         │
   │  agent      :4000│◄─┤  VictoriaLogs            │
   │  node-exporter   │◄─┤  vmagent + blackbox      │
   │  cAdvisor        │  │                          │
   └──────────────────┘  └──────────────────────────┘
          └──────── private network ────────┘
```

- **Apps server:** Caddy terminates HTTPS and proxies to one container per app. The
  agent deploys apps when the dashboard asks. Exporters expose host and container metrics.
- **Ops server:** the dashboard (SvelteKit) and the monitoring stack. It is a separate
  machine so it can still report when the apps server is down.
- Only Caddy is public on each server; everything else talks over the private network.

## Repository

| Path                | What                                                  |
| ------------------- | ----------------------------------------------------- |
| `apps/dashboard`    | SvelteKit dashboard (ops server)                      |
| `apps/site`         | SvelteKit website and docs                            |
| `agent`             | Fastify agent (apps server)                           |
| `infra/apps-server` | compose, Caddyfile, cloud-init for the apps server    |
| `infra/ops-server`  | compose, scrape config, cloud-init for the ops server |
| `infra/hetzner`     | optional OpenTofu module for Hetzner Cloud            |
| `docs/decisions`    | architecture decision records                         |

## Development

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm verify      # biome check + typecheck + build
```

## Deploying your own

Fork the repo and keep your values in a GitHub environment (e.g. `production`): the
Hetzner token, SSH key and domains as secrets and variables. Nothing personal lives in
the repository.
