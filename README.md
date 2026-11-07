# Spotcraft

Self-hosted deployment for a handful of web apps on your own VPSes. Point it at
Docker images, and it runs them behind HTTPS, monitors them, and shows everything in
one dashboard.

Built for about ten small-to-mid server-rendered apps. Works on any Debian/Ubuntu VPS,
with an optional OpenTofu module for Hetzner Cloud.

> Status: the agent and dashboard work and publish as images, and OpenTofu creates the
> Hetzner servers; the deploy workflow is next.

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

Fork the repo and keep your values in a GitHub environment (e.g. `production`): the
Hetzner token, SSH key and domains as secrets and variables. Nothing personal lives in
the repository.

## Agent skills

`.claude/skills/` holds vendored [agent skills](https://docs.claude.com/en/docs/claude-code/skills)
for this stack: Svelte (official), shadcn-svelte (official), Fastify and Node (mcollina), pnpm and
Vite (antfu), Docker (official), Terraform style (HashiCorp, applies to OpenTofu), VictoriaMetrics and
VictoriaLogs queries (official), web interface guidelines (Vercel), and a local `commit-message`.

`skills-lock.json` records each skill's source, commit, license and local patches. Patches keep
agents on pinned tools: no unpinned `npx …@latest`, no blanket pre-approved `curl`, no rules
fetched from a moving branch. To update a skill, re-copy it at a newer commit, re-apply its
patches and bump the commit in the lock file.
