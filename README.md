# Spotcraft

Self-hosted deployment for a handful of web apps on your own servers ([spotcraft.dev](https://spotcraft.dev)). Give it a Docker image
and a domain; it runs the app behind HTTPS, monitors it, and shows everything in one dashboard.

Spotcraft is made for one person running about ten small-to-mid server-rendered apps. It runs on
two Debian/Ubuntu VPSes, with an optional OpenTofu module that creates them on Hetzner Cloud.
It is not a PaaS: there is no build step, no multi-tenancy, and no database to look after.

> **Status: 0.x.** It runs real apps in production, but its interfaces may still change between
> minor versions. See the [changelog](CHANGELOG.md).

## What you get

- **Deploys from a form.** Image, tag (with suggestions from Docker Hub), domain, port, limits
  and environment variables. Spotcraft pulls the image, waits until the app is healthy, then
  switches traffic. If anything fails, the previous version keeps running.
- **HTTPS without thinking about it.** Caddy gets and renews Let's Encrypt certificates and
  redirects `www.` for root domains.
- **Monitoring built in.** Uptime and response time from outside, CPU and memory per app, host
  CPU, memory and disk, and each app's logs, in the dashboard.
- **Hardened by default.** Apps run without Linux capabilities, read-only, with limits. See the
  [security model](docs/security.md).
- **Your secrets stay yours.** Everything personal lives in a GitHub environment, never in the
  repository.

## How it fits together

```
                internet
           ┌───────┴────────┐
         80/443            80/443
  ┌────────▼─────────┐  ┌───▼──────────────────────┐
  │   apps server    │  │        ops server        │
  │  Caddy           │  │  Caddy → dashboard       │
  │  app containers  │  │  VictoriaMetrics         │
  │  agent      :4000│◄─┤  vmagent + blackbox      │
  │  node-exporter   │◄─┤                          │
  │  cAdvisor        │  │                          │
  └──────────────────┘  └──────────────────────────┘
         └──────── private network ────────┘
```

- **Apps server:** Caddy terminates HTTPS and proxies to one container per app. The agent
  deploys apps when the dashboard asks; it keeps each app's settings as files, which are the
  only record of what runs.
- **Ops server:** the dashboard and the monitoring. It's a separate machine, so it can still
  tell you when the apps server is down.
- Only Caddy faces the internet on each server; everything else talks over the private network.

Why it's built this way is recorded in the [decision records](docs/decisions).

## Deploying your own

Fork the repository, create two servers (an OpenTofu module does it on Hetzner), point a
domain at the dashboard, fill in a GitHub environment, and run the **Deploy** workflow. The
whole walk-through is in [Getting started](docs/getting-started.md), also at
[spotcraft.dev/docs](https://spotcraft.dev/docs/getting-started).

To upgrade, run the Deploy workflow with the new version. To roll back, run it with the old one.

## Versions

Spotcraft has one version for everything, following [Semantic Versioning](https://semver.org).
Images are tagged `0.1.0` and `0.1` (and `latest` from `main`). What counts as a breaking change
is defined in [ADR 0013](docs/decisions/0013-one-version.md); changes are listed in the
[changelog](CHANGELOG.md).

## Repository

| Path                     | What                                                  |
| ------------------------ | ----------------------------------------------------- |
| `agent`                  | the agent (Fastify), runs on the apps server          |
| `apps/dashboard`         | the dashboard (SvelteKit), runs on the ops server     |
| `apps/site`              | the project website                                   |
| `packages/cli`           | the `spotcraft` command: `spotcraft dev` local stack  |
| `packages/kit`           | app databases' `auth` schema and their provisioning   |
| `packages/ui`            | shared components and theme (shadcn-svelte)           |
| `infra/cloud-init.yaml`  | first-boot setup for either server                    |
| `infra/apps-server`      | compose file and Caddyfile for the apps server        |
| `infra/ops-server`       | compose file, Caddyfile and scrape config for the ops |
| `infra/hetzner`          | optional OpenTofu module for Hetzner Cloud            |
| `infra/remote-deploy.sh` | what the Deploy workflow runs on each server          |
| `docs`                   | security model and decision records                   |

## Development

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm verify      # lint, version check, typecheck, tests, build
```

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). The agent skills in `.claude/skills/` keep their own licenses
(see [NOTICE](NOTICE)).
