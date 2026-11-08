# Changelog

All notable changes to Spotcraft are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). What counts as
Spotcraft's public API, and so what makes a change breaking, is defined in
[ADR 0013](docs/decisions/0013-one-version.md). While the version is 0.y.z, a breaking change
raises the minor version and is listed under **Changed** or **Removed** with migration steps.

## [Unreleased]

### Added

- **Postgres** on the apps server (`postgres` service, Postgres 18), the base for databases for
  hosted apps. Reachable only inside Docker; the superuser only over the local socket.
- **App databases** in the agent's API: `database: true` gives an app its own Postgres role and
  database as `DATABASE_URL`. Removing an app keeps its database unless `?purge=true`. When
  the agent starts, it brings every app database up to date.
- **Dashboard**: a Database checkbox when adding or editing an app, the database in the app's
  settings, and "Also delete its database" when removing it.

### Changed

- The Deploy workflow needs a new secret, `POSTGRES_AGENT_PASSWORD` (`openssl rand -hex 32`),
  on the `production` environment. Add it before deploying this version, or the deploy stops
  with "POSTGRES_AGENT_PASSWORD is empty". The apps server needs about 1 GB more memory.

## [0.1.0] - 2026-11-07

The first release: two servers, a deploy agent, a dashboard, and monitoring, enough to run a
handful of server-rendered apps from Docker Hub images behind HTTPS.

### Added

- **Apps server**: Caddy with automatic HTTPS in front of one container per app; `www.`
  redirects for root domains; HTTP/3.
- **Agent** (`spotcraft-agent` image): HTTP API on the private network to list, deploy, update,
  remove and read logs of apps. A deploy pulls the image, starts it with a health wait and
  reloads Caddy, and puts the previous version back if any step fails.
- **Dashboard** (`spotcraft-dashboard` image): password login; apps list with status and
  24-hour uptime; add and edit apps with tag suggestions from Docker Hub; per-app reachability,
  uptime, CPU, memory, response time and logs; redeploy and remove; a server page with host
  CPU, memory, disk, load and uptime.
- **Monitoring** on the ops server: VictoriaMetrics, vmagent, node-exporter and cAdvisor
  metrics, and HTTPS uptime probes of every app that follow the app list automatically.
- **Hetzner module** (OpenTofu): two ARM servers, a private network, a cloud firewall and a
  deploy key; optional daily backups of the apps server.
- **First-boot setup** (`infra/cloud-init.yaml`) for any Debian/Ubuntu VPS.
- **Deploy workflow**: deploys both servers at a published image tag from a GitHub
  environment, then checks the dashboard from outside.
- Multi-arch images (amd64 and arm64) on Docker Hub with provenance and SBOM.
- **Website** at spotcraft.dev (`spotcraft-site` image): a home page and the docs for each
  release, rendered from the repository's Markdown.
- The dashboard follows the system's dark mode.

### Security

- Hosted apps run without Linux capabilities, with `no-new-privileges`, a read-only root
  filesystem by default, and memory, CPU and process limits.
- Spotcraft's own services run without capabilities (Caddy keeps `NET_BIND_SERVICE`), read-only
  where possible, with limits and health checks; none runs privileged.
- The agent answers only the ops server's private address and requires a bearer token.
- The dashboard uses a scrypt password hash, an HMAC-signed `SameSite=Strict` session cookie, a
  per-address login lockout, a nonce-based CSP, HSTS and a 1 MB request limit.
- Real client addresses for IPv6 visitors (IPv6-enabled Docker networks).
- Distroless Node 26 images; CI fails on fixable HIGH/CRITICAL vulnerabilities; Dependabot
  proposes weekly updates. Base images and actions are pinned by digest and commit.
- Servers: key-only SSH as a `deploy` user with modern algorithms only, root login refused,
  two firewalls, automatic security updates.

[Unreleased]: https://github.com/vindotski/spotcraft/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vindotski/spotcraft/releases/tag/v0.1.0
