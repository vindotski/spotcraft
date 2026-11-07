---
title: A small agent deploys apps
number: 2
status: accepted
implementation: planned
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# A small agent deploys apps

## Context

The dashboard on the ops server has to start, update and remove apps on the apps
server. Alternatives were SSH from the dashboard (a compromised dashboard is root on the
apps server) and GitOps through GitHub Actions (slower, and the dashboard needs a GitHub
token).

## Decision

A small HTTP service, the **agent**, runs on the apps server, listens only on the private
network and requires a token. It writes each app's compose file and Caddy site block and
runs docker. The dashboard never holds SSH credentials.

## Consequences

- The agent mounts the Docker socket, so it is effectively root on the apps server; the
  private-network binding and the token are what protect it.
- The agent's API is the one place that defines what a deploy is.
