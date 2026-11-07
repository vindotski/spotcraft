---
title: Spotcraft deploys itself with a manual GitHub workflow over SSH
number: 11
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# Spotcraft deploys itself with a manual GitHub workflow over SSH

## Context

Hosted apps are deployed from the dashboard (ADR 0002). Spotcraft's own services (agent,
dashboard, monitoring, Caddy) need a way onto the two servers that keeps secrets out of the
repository and works for forks.

## Decision

- A manual `Deploy` workflow takes an image tag (`latest`, or `sha-…` to pin or roll back)
  and deploys the apps server first, then the ops server, then checks the dashboard from outside.
- Plain `ssh`/`scp` as the `deploy` user, host keys pinned in a secret, no third-party
  deploy action (the pattern the owner's other projects use).
- Values live in a GitHub environment (`production`): hosts and domain as variables; the SSH
  key, known hosts, agent token, session secret and password hash as secrets.
- Secrets travel over SSH's stdin, never on a command line, and land in a `.env` readable only
  by `deploy`. Values that `.env` can't hold safely unquoted (spaces, quotes, `$`, `#`) are
  refused.
- Each deploy prunes images older than a week, keeping recent ones for rollbacks.

## Consequences

- Changing a secret means re-running the workflow.
- The deploy key is root-equivalent on both servers (docker group); it lives only in the
  GitHub environment and on the owner's machine.
