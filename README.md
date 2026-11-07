# Spotcraft

Self-hosted deployment for a handful of web apps on your own servers. Give it a Docker image
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

1. **Fork** this repository.
2. **Servers.** Create two servers with [`infra/hetzner`](infra/hetzner), or any two
   Debian/Ubuntu VPSes prepared with [`infra/cloud-init.yaml`](infra/cloud-init.yaml) and a
   private network between them (`10.0.0.2` apps, `10.0.0.3` ops by default).
3. **DNS.** Point the dashboard's domain (A and AAAA) at the ops server.
4. **Images.** Either use the published images (`vindotski/spotcraft-*`), or publish your own:
   set the repository variable `DOCKERHUB_USERNAME` and the secret `DOCKERHUB_TOKEN` (a Docker
   Hub token with read and write access) and push to `main`.
5. **GitHub environment.** In the repository settings, create the environment `production`:

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

   Optional variables: `APPS_PRIVATE_IP` and `OPS_PRIVATE_IP` if your private addresses differ.

6. **Deploy.** Run the **Deploy** workflow (Actions → Deploy → Run workflow) with a version such
   as `0.1.0`, or `latest`. It deploys the apps server, then the ops server, waits for every
   service to be healthy, and checks the dashboard from outside.

Then log in at your dashboard's domain and add your first app. Point the app's domain at the
apps server; its certificate arrives on the first request.

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
