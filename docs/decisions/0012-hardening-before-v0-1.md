---
title: Hardening from the v0.1.0 audit
number: 12
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: "From the audit recorded before v0.1.0 (Trivy, nmap, testssl.sh, ssh-audit, code review)."
---

# Hardening from the v0.1.0 audit

## Context

An audit before the first release found no urgent problem but several gaps: ~190 CVEs per
image from unused Debian packages, IPv6 visitors sharing one address, hosted apps able to reach
the agent's port, no HSTS on the dashboard, Spotcraft's own containers without limits, `www.`
sites for subdomains, and old SSH fallback algorithms.

## Decision

- **Distroless images**: both images run on distroless Node 26 (no shell or package manager):
  about 50 CVEs each instead of about 190, none fixable at release time except one inside the
  Docker CLI binaries, accepted with an expiring exception.
- **CI gate**: Trivy fails the build on HIGH/CRITICAL vulnerabilities that have a fix; accepted
  exceptions live in `.trivyignore.yaml` with a reason and an expiry. Dependabot proposes weekly
  grouped updates for npm, actions, Dockerfiles, compose files and OpenTofu.
- **IPv6**: Caddy's networks have IPv6 enabled, so Docker forwards IPv6 visitors with kernel NAT
  and their real addresses reach the apps. The deploy script migrates existing networks once.
- **Agent allowlist**: the agent answers only `AGENT_ALLOWED_IPS` (the ops server) and its own
  loopback, before checking the token.
- **Container baseline**: every Spotcraft service drops all capabilities (Caddy keeps
  `NET_BIND_SERVICE`), sets `no-new-privileges`, a read-only root, memory and pid limits, and a
  health check where the image allows. cAdvisor no longer runs privileged.
- **Host settings through the deploy**: cloud-init only runs once, so the deploy script applies
  host settings (modern-only SSH algorithms, validated with `sshd -t` before reload) through a
  short-lived privileged container; the deploy user's docker group is root-equivalent anyway.
- `www.` redirects only for root domains; HSTS, security headers and a body limit on the
  dashboard's Caddy.

## Consequences

- The first deploy with these changes pauses hosted apps for about a minute (network migration).
- Distroless images have no shell: debugging uses `docker exec … /nodejs/bin/node -e …` or a
  debug sidecar.
- Exceptions in `.trivyignore.yaml` expire and fail CI again unless renewed or fixed.
