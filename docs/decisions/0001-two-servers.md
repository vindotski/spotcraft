---
title: Apps and ops on two servers
number: 1
status: accepted
implementation: skeleton
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# Apps and ops on two servers

## Context

Spotcraft hosts up to about ten small-to-mid SSR apps and has to report on them. If
monitoring ran on the same machine as the apps, an overloaded or dead apps server would
take its own alarm down with it.

## Decision

Two servers. The **apps server** runs Caddy, the app containers, the agent and the
exporters. The **ops server** runs the dashboard and the monitoring stack. They talk over a
private network (a Hetzner network, or WireGuard elsewhere). Only Caddy is public on each.

## Consequences

- Two machines to pay for and patch; the ops one can be small (about 4 GB RAM).
- An apps-server outage is visible from the ops server and from its external probes.
- Everything between the servers stays off the public internet.
