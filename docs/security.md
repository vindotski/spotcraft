# Security model

Spotcraft runs a handful of apps for one operator on two servers. This page describes what it
protects, what it trusts, and the risks it accepts. Report vulnerabilities as described in
[SECURITY.md](../SECURITY.md).

## What is trusted

| Who or what                       | Trusted with                              | Why                                         |
| --------------------------------- | ----------------------------------------- | ------------------------------------------- |
| The operator (dashboard password) | deploying and removing any app            | one admin by design                         |
| The deploy key (`deploy` user)    | root on both servers                      | the `docker` group is root-equivalent       |
| GitHub `production` environment   | every secret                              | it runs the deploy                          |
| The agent                         | root on the apps server                   | it holds the Docker socket                  |
| Hosted apps                       | nothing beyond their own container        | they are treated as untrusted               |
| The private network               | carrying the agent token and app settings | isolated per Hetzner project, not encrypted |

## Boundaries

**From the internet**, each server answers only SSH (22), HTTP (80) and HTTPS (443), enforced by
Hetzner's cloud firewall and ufw on the server. SSH accepts only keys, only for `deploy`, with
modern algorithms only. Everything else (the agent, exporters, metrics, Caddy's admin API)
listens on the private network or inside Docker.

**The dashboard** requires a session for every page but the login. Sessions are signed cookies
(`HttpOnly`, `Secure`, `SameSite=Strict`) that expire after seven days. Five failed logins
from one address within 15 minutes lock that address out. Forms are protected by SvelteKit's
origin check; pages get a nonce-based Content-Security-Policy, HSTS, `X-Frame-Options: DENY`
and `Cache-Control: no-store`.

**The agent** accepts requests only from the ops server's private address (and its own
loopback), then only with the bearer token, compared in constant time. Every value it receives
is validated by JSON Schema (unknown fields are rejected) before it reaches a file or a command.
Commands run without a shell. Generated Compose files are JSON, so input never needs YAML
escaping, and `$` is escaped so Compose never interpolates it.

**Hosted apps** run as separate Compose projects with no Linux capabilities, `no-new-privileges`,
a read-only root filesystem by default, and memory, CPU and process limits. They can reach Caddy
and each other on the shared edge network, and the apps server's private address, where the
agent refuses them.

**Spotcraft's own containers** run without capabilities (Caddy keeps `NET_BIND_SERVICE` for ports
80 and 443), with `no-new-privileges`, read-only root filesystems where the software allows,
limits and health checks. None runs privileged. The agent and dashboard images are distroless
(no shell, no package manager).

**Secrets** live in the GitHub environment and in each server's `/opt/spotcraft/.env` (mode
600, owned by `deploy`). The deploy sends them over SSH's stdin, never on a command line. None
are in the repository or in images.

## Accepted risks

- **The agent holds the Docker socket.** Whoever controls the agent controls the apps server.
  The private-network binding, the address allowlist and the token are what protect it.
- **The private network is not encrypted.** Hetzner isolates it per project, but the agent token
  and app settings (including their environment variables) cross it as plain HTTP. Encrypting
  it (WireGuard) is planned.
- **Hosted apps share one network.** An app can open connections to another app's container.
  Separate networks per app are planned. Don't host apps that must not see each other.
- **Host metrics are readable from hosted apps.** node-exporter and cAdvisor listen on the apps
  server's private address, which app containers can reach; they expose resource usage, not
  secrets.
- **The deploy key is root-equivalent** on both servers. Keep it only in the GitHub environment
  and on the operator's machine.
- **No automatic reboots.** Security updates install daily, but kernel updates take effect only
  after a manual reboot.

## Supply chain

Base images and third-party images are pinned by version and digest; GitHub Actions by commit
SHA. The pnpm workspace installs only releases older than a day, refuses provenance downgrades
and exotic transitive sources, and lets only listed packages run install scripts. CI scans both
images with Trivy and fails on fixable HIGH/CRITICAL vulnerabilities; accepted exceptions are
listed in `.trivyignore.yaml` with a reason and an expiry date. Dependabot proposes weekly
updates. Published images carry provenance and an SBOM.
