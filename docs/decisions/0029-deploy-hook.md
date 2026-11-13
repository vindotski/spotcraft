---
title: An app's CI deploys a new tag through a deploy hook
number: 29
status: accepted
implementation: done
date: 2026-11-13
supersedes: []
superseded_by: []
notes: "Built: per-app hook tokens (hash in secrets.json), the agent's release routes (one waiting per app, token re-checked when it runs), the dashboard's /hooks/deploy/<name>, and an Access bypass for that path in infra/cloudflare."
---

# An app's CI deploys a new tag through a deploy hook

## Context

After every build an app's CI publishes an image tag (`sha-abc1234`), and someone then picks
that tag in the dashboard. The CI can't do it itself:
- the agent listens only on the server's internal network and takes one token, the dashboard's
  ([ADR 0002](0002-agent-control-path.md));
- the dashboard is behind a sign-in, and behind Cloudflare Access when that is set up
  ([ADR 0023](0023-access-sign-in.md)).

Behind Cloudflare, a request that takes longer than 100 seconds is cut off. A deploy can take
two minutes: the image pull plus up to 120 seconds for the health check.

## Decision

- **Each app can have a deploy hook token.**
  - The dashboard's app page turns it on, makes a new one (which replaces the old), or turns it
    off.
  - A new token is 32 random bytes, shown once.
  - The agent keeps only its SHA-256, in the app's `secrets.json`. Removing the app removes it.
- **The hook is a dashboard route, `/hooks/deploy/<name>`.**
  - Exactly that path skips the dashboard's sign-in, and in `infra/cloudflare` an Access
    application for `<dashboard>/hooks/deploy` bypasses Access.
  - The rest of the dashboard is unchanged.
  - The agent stays where ADR 0002 puts it: the dashboard relays each call with its own token
    and adds the hook token in `X-Hook-Token`.
- **`POST {"tag": "<tag>"}` with `Authorization: Bearer <hook token>` starts a release.**
  - The agent checks the token against the hash in constant time.
  - It takes the app's stored spec and changes only the tag. The image, env, limits and
    domain can't change through the hook, and it never takes over DNS records
    ([ADR 0022](0022-takeover-setting.md)), even if the app's setting allows it.
  - The deploy runs in the agent's queue, reading the spec there, so an edit queued before it
    is kept.
  - At most one hook release per app waits in the queue. A newer one replaces its tag, so
    repeated calls can't pile up deploys in front of other apps.
  - When it runs, the token it came with must still be the app's: turning the hook off or
    making a new token also stops a release that is waiting.
  - The answer is 202, at once.
- **`GET` says how the last release went:** `deploying`, `live` or `failed`, with the tag, the
  time and, on failure, the agent's message without command output. The agent keeps this in
  memory. After a restart, GET reports `live` with the app's current tag.
- **Wrong, rotated and missing tokens, and unknown apps, all get 401**, so a caller learns
  nothing about which apps exist. The POST takes JSON only.

## Consequences

- CI deploys every build: POST the tag, then poll GET until `live` or `failed`. The dashboard
  shows a ready GitHub Actions step.
- A token leaked from CI can deploy any tag of that app's image, and nothing else. Rotating it
  in the dashboard stops the old one at once.
- The dashboard now has a path anyone can reach without a sign-in. It answers only to a valid
  token, and the token is checked by the agent.
- The release state doesn't survive a restart of the agent. Then GET says `live` with the tag
  that is running, which might be the old one if the release was cut short, so CI checks that
  the tag is its own.
