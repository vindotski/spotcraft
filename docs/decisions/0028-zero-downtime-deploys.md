---
title: Deploys start the new version next to the old one
number: 28
status: accepted
implementation: done
date: 2026-11-13
supersedes: []
superseded_by: []
notes: "Built in the agent: two slots per app, Caddy moves traffic once the new slot is healthy, the old slot then stops. Apps deployed before move into a slot on their next deploy."
---

# Deploys start the new version next to the old one

## Context

An app is one Compose service. A deploy ran `docker compose up` on it, so Compose stopped the
old container before the new one had started: every release had seconds of downtime, and a
failed release had more, because putting the old version back recreated the container again.
Apps are deployed often, and from CI once a deploy hook exists, so the gap adds up.

## Decision

- **Two slots per app,** `blue` and `green`. Each is a Compose service named `<name>-<slot>` in
  the app's one project, `spotcraft-app-<name>`, reached by Caddy as `app-<name>-<slot>` on the
  edge network. The project stays the same, so metrics and logs keep finding the app by it.
- **The app's compose file holds only the live slot.** It is the record of which slot is live.
- **A deploy uses the other slot:**
  1. write the compose file with the new slot's service;
  2. `pull`, then `up -d --wait` for that service only, without `--remove-orphans`, so the live
     slot keeps serving;
  3. once it is healthy, point the app's Caddy site at it and reload Caddy (graceful);
  4. stop the old slot with `docker stop --time 30` (its `stop_grace_period`), so it can finish
     the requests it has, then remove it.
- **A failed deploy** removes the new slot and puts the previous files back. Traffic never
  moved, so the live slot isn't restarted.
- **Names ending in `-blue` or `-green` are reserved,** as `app-…` already is: an app called
  `blog-blue` would collide with a slot of `blog`.
- **Apps deployed before** have one service named after the app. It counts as the live slot:
  the next deploy starts `blue` next to it and then removes it.

## Consequences

- No downtime when a release is healthy, and none when it isn't.
- For a few seconds two versions of the app run against the same database. Migrations must only
  add (new tables, new nullable columns), so the old version keeps working until it stops. A
  migration that renames or drops something needs its own plan.
- An app's memory briefly doubles during a deploy. The server needs room for the largest app
  twice.
- An image without a HEALTHCHECK counts as ready once it runs, so traffic can move before it
  answers. Images should have one.
- Requests still open on the old slot after 30 seconds are cut off.
