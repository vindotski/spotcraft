# Changelog

All notable changes to Spotcraft are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). What counts as
Spotcraft's public API, and so what makes a change breaking, is defined in
[ADR 0019](docs/decisions/0019-one-version-with-npm.md). While the version is 0.y.z, a breaking change
raises the minor version and is listed under **Changed** or **Removed** with migration steps.

## [Unreleased]

### Added

- **The website moved to GitHub Pages** ([ADR 0024](docs/decisions/0024-website-on-pages.md)).
  It's now plain Astro with no client-side JavaScript, deployed from `main` by the new Pages
  workflow, with a build check for missing pages, broken links and anchors. The URLs are
  unchanged.

- **One sign-in behind Cloudflare Access** ([ADR 0023](docs/decisions/0023-access-sign-in.md)):
  with the new `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` variables on the `production`
  environment, the dashboard accepts Access's signed token and skips its password. Log out
  also ends the Access sign-in. `infra/cloudflare` has a new `dashboard_settings` output with
  the AUD. The password login stays for use without Access.

- The dashboard shows the running Spotcraft version in its footer once you're signed in,
  linked to the release notes.

### Removed

- **The `spotcraft-agent` and `spotcraft-dashboard` images**: one image, `spotcraft`, now runs
  both as two containers ([ADR 0025](docs/decisions/0025-one-image.md)). **Breaking:** take the
  new `infra/*/compose.yaml` files (the deploy copies them), which use `SPOTCRAFT_IMAGE`; a
  fork publishes `<DOCKERHUB_USERNAME>/spotcraft`. Run the Deploy workflow with a tag of the
  new image. The old images stay on Docker Hub but get no new versions.
- The `spotcraft-site` image is no longer built or published; the site isn't an app on the
  apps server any more.

### Security

- A crafted dashboard link with an encoded `?` or `#` in the app name (for example
  `/apps/blog%3Fpurge=true`) could turn Remove into "remove and delete the database", or a user
  delete into an app delete. App routes now only match valid names, and agent calls encode them.
- App names starting with `app-` are refused: `app-<name>` is how Caddy reaches each app, so such
  an app could receive another app's traffic.
- A custom domain can't be one of the apps domain's own hosts (`fallback.`, `www.`…), whose
  records OpenTofu manages.
- Each app's `compose.yaml`, which carries its database password, is now mode 600, like
  `secrets.json`. The agent tightens existing ones when it starts.
- The dashboard's login lockout counts an IPv6 client by its /64 and no longer grows without
  bound.
- The agent and the kit pin `search_path` when they work in an app's database.

### Changed

- **Performance**: cAdvisor collects only containers' CPU and memory, every 30 seconds, with the
  Compose project label (about a sixth of the series). An app's page no longer waits for the app
  before starting its metric queries and logs, and streams its domain status (which asks
  Cloudflare) instead of waiting for it; the edit page streams Docker Hub's tags. The image
  build fetches dependencies from the lockfile in their own cached layer.
- **`@spotcraft/kit` has its own version** ([ADR 0027](docs/decisions/0027-kit-version.md)) and
  its own [changelog](packages/kit/CHANGELOG.md), released with `kit-vX.Y.Z` tags; it stays at
  0.3.0 for now. Spotcraft releases (`vX.Y.Z`) publish the image and the CLI, which pins the
  kit's exact version, and CI refuses one whose kit isn't on npm or changed since its tag.
  Apps no longer get a new kit version with every Spotcraft release.
- **Spotcraft runs on one server** ([ADR 0026](docs/decisions/0026-one-server.md)). The agent,
  the dashboard, Postgres and the monitoring share one Compose stack in `infra/server`, which
  replaces `infra/apps-server` and `infra/ops-server`. Docker networks replace the private
  network: hosted apps reach only Caddy and Postgres, and only the dashboard reaches the agent.
  Behind a Cloudflare Tunnel, Caddy trusts `CF-Connecting-IP` from cloudflared only and serves
  the dashboard only to it. The agent also reserves `dashboard`, `cloudflared`,
  `victoriametrics`, `vmagent` and `blackbox` as app names and refuses `DASHBOARD_DOMAIN` as an
  app host.
  `infra/hetzner` creates one server and no network; `infra/cloudflare` keeps one tunnel. Add an
  external uptime check on the dashboard's URL, since the monitoring now shares the server.
  **Breaking**, migration from two servers:
  1. In the `production` environment, add the variable `SERVER_HOST` (the apps server's public
     IP) and the secret `CLOUDFLARE_TUNNEL_TOKEN` (the value of `CLOUDFLARE_TUNNEL_TOKEN_APPS`).
  2. Run Deploy with the new version. The apps server now runs everything. The old dashboard on
     the ops server loses the agent here, so expect a few minutes without a dashboard; hosted
     apps keep running.
  3. Stop the ops server's stack (`docker compose down` in `/opt/spotcraft` there).
  4. Behind Cloudflare: `tofu plan` in `infra/cloudflare` must show the dashboard record moving
     to the `spotcraft-apps` tunnel, `spotcraft-ops` being destroyed, and **no replacement** of
     `spotcraft-apps`. Then `tofu apply`. Without Cloudflare: point the dashboard's A and AAAA
     records at the apps server.
  5. `tofu plan` in `infra/hetzner` must show the ops server and the private network being
     destroyed and no replacement of `spotcraft-apps`. The ops server has delete protection: set
     `protect_servers = false` for that one apply, then back to `true`.
  6. Remove `APPS_HOST`, `OPS_HOST`, `APPS_PRIVATE_IP`, `OPS_PRIVATE_IP`,
     `CLOUDFLARE_TUNNEL_TOKEN_APPS` and `CLOUDFLARE_TUNNEL_TOKEN_OPS`, trim `KNOWN_HOSTS` to the
     server's key, and remove the leftover `ufw allow from 10.0.0.0/16` rule on the server.
     The metrics history from the ops server isn't carried over.
- **Taking over a custom domain's DNS records is now an app setting**
  ([ADR 0022](docs/decisions/0022-takeover-setting.md)). `takeOver` is stored in `app.json`,
  returned by `GET /apps/:name` and sent in the `PUT` body. The dashboard's checkbox keeps its
  value, and while it is on every deploy may replace records Spotcraft didn't make.
  **Breaking (agent API):** the `?takeOver=true` query parameter is gone. Send
  `"takeOver": true` in the body instead. Existing apps start with it off.

## [0.3.0] - 2026-11-13

An address for every app, and Spotcraft behind Cloudflare if you want it
([ADR 0021](docs/decisions/0021-cloudflare-edge.md)). Nothing changes until you set the new
settings.

### Added

- **Default subdomains**: with the `APPS_DOMAIN` variable, every app is served at
  `<name>.<APPS_DOMAIN>`; the app's `domain` becomes an optional custom domain. The agent has
  `GET /settings`, and every app lists its `hostnames`.
- **`infra/cloudflare`**, an OpenTofu module: Cloudflare Tunnels for both servers, the wildcard
  and dashboard records, zone TLS settings, bot switches, a rate limit on `/login`, Access in
  front of the dashboard, and Cloudflare for SaaS for custom domains outside the account.
- **Tunnel mode** (`EDGE=cloudflare` with the `CLOUDFLARE_TUNNEL_TOKEN_APPS` and `_OPS` secrets):
  `cloudflared` runs on both servers, Caddy is published on loopback only, and the dashboard and
  apps are served over plain HTTP to the tunnel. `infra/hetzner` gains `edge = "cloudflare"` to
  close ports 80 and 443.
- **Custom domains through Cloudflare**: with the agent's `CLOUDFLARE_*` settings, a domain in the
  account gets a proxied CNAME to the tunnel, and any other domain a custom hostname. The dashboard
  shows each domain's status and the records still to add. `PUT /apps/:name?takeOver=true` replaces
  records Spotcraft didn't make.
- **Require sign-in**: `protected: true` puts an app behind Cloudflare Access with the owners'
  policy (`CLOUDFLARE_ACCESS_POLICY_ID`). Its uptime probe expects the Access sign-in redirect.

### Changed

- Caddy passes each visitor's address to apps and the dashboard as `X-Forwarded-For`, and trusts
  `CF-Connecting-IP` only from `CADDY_TRUSTED_PROXIES` (loopback unless behind the tunnel).
- The ops server gets `blackbox.yml` with the probe modules; the Deploy workflow copies it.
- The Deploy workflow's final check also accepts a redirect to Cloudflare Access.
- When the agent starts, it rewrites every app's Caddy site for the current `EDGE` and
  `APPS_DOMAIN` (protecting a protected app's new hosts first), so a mode switch reaches every
  app without redeploying each one.
- A failed deploy puts the domain's DNS back exactly as it was, including records a take-over
  replaced.
- An app's uptime averages all of its addresses, and "Reachable now" needs every address up.
- `dev` is now the default branch; `main` holds the released version. The `latest` image tag is
  published from `main`.
- Dependencies: Caddy 2.11.9, VictoriaMetrics and vmagent v1.156.0, Node 26.13.1 and refreshed
  distroless images, SvelteKit 3.2, better-auth 1.7.21, `@types/node` 26 (matching Node 26).
  TypeScript stays on 6 until `svelte-check` supports 7.

## [0.2.0] - 2026-11-08

Databases for hosted apps, and a backend kit that gives server-rendered apps guest accounts:
one Postgres on the apps server with a database per app, the `spotcraft dev` command to run
the same setup locally, and the dashboard to see and delete an app's users. **Before
deploying, add the `POSTGRES_AGENT_PASSWORD` secret** (see Changed).

### Added

- **Postgres** on the apps server (`postgres` service, Postgres 18), the base for databases for
  hosted apps. Reachable only inside Docker; the superuser only over the local socket.
- **App databases** in the agent's API: `database: true` gives an app its own Postgres role and
  database as `DATABASE_URL`. Removing an app keeps its database unless `?purge=true`. When
  the agent starts, it brings every app database up to date.
- **`spotcraft dev`** (`packages/cli`): the apps server's Postgres and app database setup on
  your machine, for local development (`start`, `stop`, `status`, `env --write`, `reset`,
  `migrate`).
- **npm packages**, published by CI on release tags with provenance: `@spotcraft/kit` and
  the CLI as `spotcraft` (`npx spotcraft dev start`). Their APIs join the public API
  ([ADR 0019](docs/decisions/0019-one-version-with-npm.md)).
- **Guide**: [Guest accounts with the backend kit](docs/guides/backend-kit.md), for a SvelteKit
  app locally and on Spotcraft.
- **Backend kit** (`packages/kit`): guest accounts for server-rendered apps on Better Auth,
  server-only (an httpOnly session cookie, no auth routes), with a guest limit per client
  address and a check of the `auth` schema version. `currentGuest` reads without creating,
  so apps create guests only when a visitor saves something, not for every page view or
  crawler.
- **App users**: for apps with a database, the dashboard lists their users (guests and
  registered, created, last seen) and deletes one with everything the app kept for them; the
  agent's API has `GET /apps/:name/users` and `DELETE /apps/:name/users/:id`.
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

[Unreleased]: https://github.com/vindotski/spotcraft/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/vindotski/spotcraft/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vindotski/spotcraft/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vindotski/spotcraft/releases/tag/v0.1.0
