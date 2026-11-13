# Spotcraft

Self-hosted deployment for a handful of web apps on your own server ([spotcraft.dev](https://spotcraft.dev)). Give it a Docker image
and a domain; it runs the app behind HTTPS, monitors it, and shows everything in one dashboard.

Spotcraft is made for one person running a handful of small-to-mid server-rendered apps. It runs
on one Debian/Ubuntu VPS, with an optional OpenTofu module that creates it on Hetzner Cloud.
It is not a PaaS: there is no build step, no multi-tenancy, and no database to look after.

> **Status: 0.x.** It runs real apps in production, but its interfaces may still change between
> minor versions. See the [changelog](CHANGELOG.md).

## What you get

- **Deploys from a form.** Image, tag (with suggestions from Docker Hub), domain, port, limits
  and environment variables. Spotcraft pulls the image, waits until the app is healthy, then
  switches traffic. If anything fails, the previous version keeps running.
- **An address for every app.** With an apps domain, every app is served at
  `<name>.<apps domain>` the moment it's deployed. A custom domain is one CNAME away, and
  `www.` redirects for root domains. Caddy gets and renews the certificates.
- **Optionally behind Cloudflare.** An OpenTofu module puts the server behind a Cloudflare
  Tunnel, so ports 80 and 443 stay closed, and adds TLS, WAF and rate-limit settings and
  Cloudflare Access for the dashboard (whose sign-in then replaces the password). The agent then sets up custom domains' DNS itself, and any
  app can require a sign-in.
- **Monitoring built in.** Uptime and response time from outside, CPU and memory per app, host
  CPU, memory and disk, and each app's logs, in the dashboard.
- **Hardened by default.** Apps run without Linux capabilities, read-only, with limits. See the
  [security model](docs/security.md).
- **Your secrets stay yours.** Everything personal lives in a GitHub environment, never in the
  repository.

## How it fits together

```
                       internet
                          │ 80/443 (or a Cloudflare Tunnel)
  ┌───────────────────────▼──────────────────────────────┐
  │  Caddy ─────► app containers ─────► Postgres          │
  │    │                                                  │
  │    └────────► dashboard ──────────► agent (Docker)    │
  │               VictoriaMetrics · vmagent · blackbox    │
  │               node-exporter · cAdvisor                │
  └───────────────────────────────────────────────────────┘
                     one server
```

- **Caddy** terminates HTTPS and proxies to one container per app, and to the dashboard.
- **The agent** deploys apps when the dashboard asks; it keeps each app's settings as files,
  which are the only record of what runs. Only the dashboard can reach it.
- **The dashboard and the monitoring** run on the same server. If the server is down, so is
  the dashboard, so add an external uptime check on the dashboard's URL.
- Only Caddy faces the internet; hosted apps reach only Caddy and Postgres.

Why it's built this way is recorded in the [decision records](docs/decisions).

## Deploying your own

Fork the repository, create a server (an OpenTofu module does it on Hetzner), point a
domain at the dashboard, fill in a GitHub environment, and run the **Deploy** workflow. The
whole walk-through is in [Getting started](docs/getting-started.md), also at
[spotcraft.dev/docs](https://spotcraft.dev/docs/getting-started).

To upgrade, run the Deploy workflow with the new version. To roll back, run it with the old one.

## Versions

Spotcraft has one version, following [Semantic Versioning](https://semver.org). The `spotcraft`
image is tagged `0.1.0` and `0.1` (and `latest` from `main`), and the CLI on npm (`spotcraft`)
carries the same version. The kit for apps, `@spotcraft/kit`, has its own version and
[changelog](packages/kit/CHANGELOG.md) ([ADR 0027](docs/decisions/0027-kit-version.md)). What
counts as a breaking change is defined in [ADR 0019](docs/decisions/0019-one-version-with-npm.md);
changes are listed in the [changelog](CHANGELOG.md).

## Repository

| Path                     | What                                                 |
| ------------------------ | ---------------------------------------------------- |
| `agent`                  | the agent (Fastify): deploys the apps                |
| `apps/dashboard`         | the dashboard (SvelteKit)                            |
| `apps/site`              | the website (Astro, on GitHub Pages)                 |
| `packages/cli`           | the `spotcraft` command: `spotcraft dev` local stack |
| `packages/kit`           | app databases' `auth` schema and their provisioning  |
| `packages/ui`            | shared components and theme (shadcn-svelte)          |
| `infra/cloud-init.yaml`  | first-boot setup for the server                      |
| `infra/server`           | compose file, Caddyfile and monitoring config        |
| `infra/hetzner`          | optional OpenTofu module for Hetzner Cloud           |
| `infra/cloudflare`       | optional OpenTofu module: tunnel, DNS, WAF, Access   |
| `infra/remote-deploy.sh` | what the Deploy workflow runs on the server          |
| `docs`                   | security model and decision records                  |

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
