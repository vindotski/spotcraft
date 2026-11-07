# Spotcraft

Self-hosted deployment for a handful of web apps on your own VPSes. Point it at
Docker images, and it runs them behind HTTPS, monitors them, and shows everything in
one dashboard.

Built for about ten small-to-mid server-rendered apps. Works on any Debian/Ubuntu VPS,
with an optional OpenTofu module for Hetzner Cloud.

> Status: MVP. The agent, dashboard, images, Hetzner servers and the deploy workflow work;
> next is moving the first real apps onto it.

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

| Path                    | What                                         |
| ----------------------- | -------------------------------------------- |
| `apps/dashboard`        | SvelteKit dashboard (ops server)             |
| `apps/site`             | SvelteKit website and docs                   |
| `packages/ui`           | shared shadcn-svelte components and theme    |
| `agent`                 | Fastify agent (apps server)                  |
| `infra/cloud-init.yaml` | first-boot setup for either server           |
| `infra/apps-server`     | compose and Caddyfile for the apps server    |
| `infra/ops-server`      | compose and scrape config for the ops server |
| `infra/hetzner`         | optional OpenTofu module for Hetzner Cloud   |
| `docs/decisions`        | architecture decision records                |

## Development

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm verify      # biome check + typecheck + build
```

## Images

CI builds `spotcraft-agent` and `spotcraft-dashboard` for amd64 and arm64 on every pull
request, and publishes them to Docker Hub from `main` (`latest`) and `v*` tags. Set the
repository variable `DOCKERHUB_USERNAME` and the secret `DOCKERHUB_TOKEN` (a Docker Hub access
token with read and write access).

## Deploying your own

1. **Servers.** Create the two servers with [`infra/hetzner`](infra/hetzner) (or any two
   Debian/Ubuntu VPSes prepared with [`infra/cloud-init.yaml`](infra/cloud-init.yaml) and a
   private network between them).
2. **DNS.** Point the dashboard's domain (A and AAAA) at the ops server.
3. **GitHub environment.** In the repository settings, create the environment `production`:

   | Kind     | Name                      | Value                                                                |
   | -------- | ------------------------- | -------------------------------------------------------------------- |
   | variable | `APPS_HOST`               | apps server public IP                                                |
   | variable | `OPS_HOST`                | ops server public IP                                                 |
   | variable | `DASHBOARD_DOMAIN`        | e.g. `ops.example.com`                                               |
   | secret   | `DEPLOY_SSH_KEY`          | the deploy user's private key                                        |
   | secret   | `KNOWN_HOSTS`             | `ssh-keyscan -t ed25519 <apps ip> <ops ip>` (check the fingerprints) |
   | secret   | `AGENT_TOKEN`             | `openssl rand -hex 32`                                               |
   | secret   | `SESSION_SECRET`          | `openssl rand -hex 32`                                               |
   | secret   | `DASHBOARD_PASSWORD_HASH` | `pnpm --filter @spotcraft/dashboard hash-password`                   |

   `APPS_PRIVATE_IP` (default `10.0.0.2`) is an optional variable. The repository-level
   `DOCKERHUB_USERNAME` tells the deploy whose images to pull.

4. **Deploy.** Run the **Deploy** workflow (Actions → Deploy → Run workflow) with a published
   tag: `latest`, or `sha-abc1234` to pin or roll back. It copies each server's compose files,
   writes its `.env` (readable only by `deploy`), pulls, starts everything and waits for
   health, apps server first, then checks the dashboard from outside.

Then log in at the dashboard's domain and add apps. Nothing personal lives in the repository.
