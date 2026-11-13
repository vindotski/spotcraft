---
title: Spotcraft runs on one server
number: 26
status: accepted
implementation: done
date: 2026-11-13
supersedes: [1, 4, 10, 11]
superseded_by: []
notes: "Fully supersedes ADR 0001; partly supersedes 0004 (both servers and the private network), 0010 (two server types, the role in cloud-init, the private-network firewall rule) and 0011 (deploying two servers). Built: infra/server, one deploy, OpenTofu modules with one server and one tunnel. The live switch is a manual runbook."
---

# Spotcraft runs on one server

## Context

ADR 0001 split Spotcraft over two servers so that the monitoring would survive the apps
server going down: an apps server (`cax21`, 8 GB) and an ops server (`cax11`, 4 GB) for the
dashboard and monitoring, joined by a private network.

In practice the ops server's stack uses about 2.3 GB of limits and the apps server's own
services about 2.2 GB, for one owner and a handful of apps. The split costs a second server, a
private network, a second Cloudflare Tunnel, two deploy steps, two compose stacks and cross-host
networking for the agent and the exporters. Spotcraft is one instance for one owner; the
smallest setup that works is one machine.

## Decision

- **One server** runs everything from `infra/server`: Caddy, cloudflared, the agent, the
  dashboard, Postgres, VictoriaMetrics, vmagent, blackbox, node-exporter and cAdvisor. Only
  Caddy is published on host ports. Spotcraft's own limits add up to about 4.2 GB, which leaves
  a `cax21` (8 GB) room for a few small-to-mid apps.
- **Docker networks replace the private network**:
  - `edge`: Caddy, Postgres and the hosted apps, as before;
  - `web`: Caddy, cloudflared, the dashboard and the monitoring;
  - `control` (internal, fixed subnet): only the dashboard and the agent; the agent's address
    allowlist is the dashboard's fixed address there;
  - `db` (internal): the agent and Postgres;
  - `default`: the agent alone, for outbound calls.
  Hosted apps reach only Caddy and Postgres.
- The Compose project keeps the name `spotcraft-apps`, the OpenTofu server and tunnel keep the
  key `apps` and the name `spotcraft-apps`, so the running server, its volumes, its tunnel and
  the agent's DNS records carry over without being replaced.
- One deploy step (`SERVER_HOST`, `CLOUDFLARE_TUNNEL_TOKEN`), one cloud-init without a role, no
  private network in `infra/hetzner`, one tunnel in `infra/cloudflare`.
- **Watching the watcher**: the monitoring can't report its own server being down. An external
  uptime check on the dashboard's URL (any free service) covers that.

## Consequences

- Half the servers, deploy steps and stacks; nothing crosses an unencrypted private network.
- One machine's outage takes the apps, the dashboard and the monitoring down together, and
  only the external check notices.
- Spotcraft's own services compete with the apps for memory and CPU, within their limits.
- Moving an existing two-server install is a manual, short-outage runbook (the CHANGELOG has
  it); the metrics history on the old ops server isn't carried over.
