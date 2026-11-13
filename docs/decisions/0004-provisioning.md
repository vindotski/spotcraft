---
title: Generic VPS bootstrap, optional Hetzner module
number: 4
status: accepted
implementation: skeleton
date: 2026-11-07
supersedes: []
superseded_by: [26]
notes: ""
---

# Generic VPS bootstrap, optional Hetzner module

## Context

Others should be able to use Spotcraft on any provider; the first deployment is on Hetzner.

## Decision

The baseline is any Debian/Ubuntu VPS reachable over SSH: `cloud-init.yaml` installs
Docker and a firewall, and `compose.yaml` runs the services. An optional OpenTofu module
in `infra/hetzner` creates both servers and the private network between them.

The owner's own deployment keeps its values (Hetzner token, SSH key, domains) in a GitHub
environment, never in the repository.

## Consequences

- Non-Hetzner users create the servers and the private link (e.g. WireGuard) themselves.
- The Hetzner module needs a state backend before it is used for real.
