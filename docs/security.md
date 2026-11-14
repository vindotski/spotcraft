# Security model

Spotcraft runs a handful of apps for one operator on one server. This page describes what it
protects, what it trusts, and the risks it accepts. Report vulnerabilities as described in
[SECURITY.md](../SECURITY.md).

## What is trusted

| Who or what                         | Trusted with                              | Why                                   |
| ----------------------------------- | ----------------------------------------- | ------------------------------------- |
| The operator (password or Access)   | deploying and removing any app            | one admin by design                   |
| The deploy key (`deploy` user)      | root on the server                        | the `docker` group is root-equivalent |
| GitHub `production` environment     | every secret                              | it runs the deploy                    |
| The agent                           | root on the server                        | it holds the Docker socket            |
| Hosted apps                         | nothing beyond their own container        | they are treated as untrusted         |
| Cloudflare (with `EDGE=cloudflare`) | all public traffic, decrypted at its edge | it terminates TLS for every app       |

## Boundaries

**From the internet**, the server answers only SSH (22), HTTP (80) and HTTPS (443), enforced by
Hetzner's cloud firewall and ufw on the server. Behind Cloudflare (`EDGE=cloudflare`, ADR 0021),
HTTP and HTTPS are closed too: `cloudflared` dials out to Cloudflare, Caddy is published on
loopback only, and visitors meet Cloudflare's TLS, WAF and DDoS protection first. Caddy then
trusts the visitor's address in `CF-Connecting-IP` from cloudflared's fixed address only, and
the dashboard's site answers only cloudflared, so nothing on the server's own networks (a
hosted app, say) gets around Access or forges an address; in direct mode Caddy trusts no such
header. SSH accepts only keys, only for `deploy`, with modern algorithms
only. Everything else (the agent, the dashboard, Postgres, exporters, metrics, Caddy's admin API) is
reachable only on Docker networks.

**The dashboard** requires a session for every page but the login and the deploy hook. Sessions are signed cookies
(`HttpOnly`, `Secure`, `SameSite=Strict`) that expire after seven days. Five failed logins
from one client within 15 minutes lock that client out; an IPv6 client counts by its /64, so
cycling addresses doesn't buy more tries. App names in dashboard URLs must match the agent's
name rule, and every agent call encodes them, so a crafted link can't add a query (such as
`?purge=true`) to a request the operator makes. Forms are protected by SvelteKit's
origin check; pages get a nonce-based Content-Security-Policy, HSTS, `X-Frame-Options: DENY`
and `Cache-Control: no-store`. With Cloudflare Access in front (`infra/cloudflare`), the owners
first sign in at Cloudflare with a one-time code, and Cloudflare also rate-limits `/login`. With
`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set, that sign-in replaces the password: the
dashboard accepts a request whose `Cf-Access-Jwt-Assertion` header is signed by the team's
published keys, for the dashboard's own Access application (tokens for protected apps are
refused), and not expired. The password login stays for use without Access.

**The deploy hook** ([ADR 0029](decisions/0029-deploy-hook.md)) is the one path anyone can
reach without a sign-in: exactly `/hooks/deploy/<name>` on the dashboard's host, which also
bypasses Cloudflare Access through its own Access application. Each app's hook is off until
an owner turns it on. Its token is 32 random bytes, shown once; the agent keeps only its
SHA-256 (in `secrets.json`, mode 600) and compares digests in constant time. The dashboard only
relays the token to the agent, behind its own token. A wrong, rotated or missing token, an app
without a hook and an app that doesn't exist all get the same 401. The hook takes JSON only, so
a browser can't post to it cross-site without a preflight, and the token is never a cookie.
A leaked token can deploy any tag of that app's image and nothing else: the image, env, limits
and domain stay as the dashboard set them, and DNS records are never taken over. At most one
release per app waits in the queue, and it runs only if its token is still the app's, so a new
token in the dashboard stops a leaked one at once, including releases already waiting.

**The agent** sits on internal Docker networks only: `control`, shared with the dashboard
alone, and `db`, shared with Postgres. It accepts requests only from the dashboard's fixed
address on `control` (and its own loopback), then only with the bearer token, compared in constant time. Every value it receives
is validated by JSON Schema (unknown fields are rejected) before it reaches a file or a command.
Commands run without a shell. Generated Compose files are JSON, so input never needs YAML
escaping, and `$` is escaped so Compose never interpolates it.

**Hosted apps** run as separate Compose projects with no Linux capabilities, `no-new-privileges`,
a read-only root filesystem by default, and memory, CPU and process limits. They can reach Caddy,
Postgres and each other on the shared edge network, and nothing else: the agent, the dashboard
and the monitoring are on networks hosted apps don't join.

**Postgres** is reachable only inside Docker: from hosted apps on the edge
network and, on an internal network, from the agent. It is never published on a host port.
The superuser only works over the container's local socket. Every other role needs a
password (SCRAM). The built-in databases are closed to everyone but the agent's role, which
can create databases and roles but is not a superuser.

**Spotcraft's own containers** run without capabilities (Caddy keeps `NET_BIND_SERVICE` for ports
80 and 443), with `no-new-privileges`, read-only root filesystems where the software allows,
limits and health checks. None runs privileged. The agent and the dashboard run from one
distroless image (no shell, no package manager), as two containers; only the agent's has the
Docker socket.

**Secrets** live in the GitHub environment and in the server's `/opt/spotcraft/.env` (mode
600, owned by `deploy`). The deploy sends them over SSH's stdin, never on a command line. None
are in the repository or in images. Each app database's password is generated by the agent and kept
in that app's `secrets.json` (mode 600). The app receives it in `DATABASE_URL`, written into
its Compose file (also mode 600) next to its other environment variables. The agent connects to
app databases with a fixed `search_path`, so schemas an app creates can't shadow what its
queries use. The agent's API never returns it.
**Backups** ([ADR 0030](decisions/0030-backups.md)) copy every app's env, database password and
database dump to a private bucket each night. The agent's key for it, in `.env`, reaches only that
bucket, where it can read and add objects. Whoever can read the bucket can read the apps' data and
secrets, so the key is kept only on the server. With the R2 bucket from `infra/cloudflare`, a
bucket lock keeps backups from being deleted or overwritten, even with that key, until shortly
before R2 deletes them after 30 days; another store needs its own rules. An app's dump is
restored as the app's own role, and `auth` as the agent's, never as the superuser: a dump can
hold functions that run during the restore with the restoring role's rights.
The agent's optional Cloudflare token can edit DNS in the account's zones, custom hostnames on
the apps zone and Access applications. The agent changes only records it marked as its own
(`spotcraft:<name>`), unless told to take a host over.

## Accepted risks

- **The agent holds the Docker socket.** Whoever controls the agent controls the server. The
  internal `control` network, the address allowlist and the token are what protect it.
- **Everything runs on one server.** The dashboard and the monitoring share the machine with
  the apps they watch: if it's down or overloaded, so are they, and the dashboard can't report
  it. An external uptime check on the dashboard's URL covers that. A hosted app that escapes
  its container reaches the same host as Spotcraft itself.
- **Hosted apps share one network.** An app can open connections to another app's container.
  Separate networks per app are planned. Don't host apps that must not see each other.
- **Postgres is shared.** Every app that has a database uses the same server, so one app's load
  affects the others, and Postgres being down affects all of them. Connections to it are not
  encrypted; they never leave the server.
- **The deploy key is root-equivalent** on the server. Keep it only in the GitHub environment
  and on the operator's machine.
- **Cloudflare sees and carries all traffic** when Spotcraft runs behind it. It terminates TLS,
  so it can read requests and responses, and if Cloudflare is down, so are the apps and the
  dashboard. The tunnel token is in the OpenTofu state and on the server.
- **Apps share the apps domain.** An app on `<name>.<apps domain>` can set cookies for the whole
  domain, which its sibling apps receive. Apps of one owner are trusted not to abuse that; use a
  dedicated apps domain, apart from the dashboard's, to avoid it.
- **Protected apps are probed only up to the sign-in.** Uptime for an app behind Access shows
  that Cloudflare and Access answer, not that the app behind them works.
- **No automatic reboots.** Security updates install daily, but kernel updates take effect only
  after a manual reboot.

## Supply chain

Base images and third-party images are pinned by version and digest; GitHub Actions by commit
SHA. The pnpm workspace installs only releases older than a day, refuses provenance downgrades
and exotic transitive sources, and lets only listed packages run install scripts. CI scans the
image with Trivy and fails on fixable HIGH/CRITICAL vulnerabilities; accepted exceptions are
listed in `.trivyignore.yaml` with a reason and an expiry date. Dependabot proposes weekly
updates. The published image carries provenance and an SBOM.
