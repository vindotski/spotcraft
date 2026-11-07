---
title: The website is static and hosted on Spotcraft itself
number: 14
status: accepted
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: []
notes: "Settles the site's static-vs-server question left open earlier."
---

# The website is static and hosted on Spotcraft itself

## Context

spotcraft.dev needs a home page and documentation. The documentation already exists as Markdown
in the repository (getting started, the security model, the decision records, the changelog),
and it must match the version people actually run.

## Decision

- **One page plus docs**: a home page in the shape of fastify.dev (what it is, strengths, how it
  works, what it's built on, a call to action) and `/docs`.
- **Docs come from the repository**: the site renders the release's own Markdown at build time.
  Links between those files become site links; links to anything else go to GitHub at the
  release tag. A broken internal link fails the build. Older versions' docs are the `docs/`
  folder at their tags.
- **Fully prerendered**: no server-side logic. It still ships as a small distroless Node image
  (`spotcraft-site`), built and scanned like the others, so it deploys like any app.
- **Hosted on Spotcraft**, as an ordinary app on the apps server, at `spotcraft.dev`.
- **Dark mode follows the system** (CSS only), for the site and the dashboard.
- The hero shows real dashboard screenshots, captured from a local demo with real metrics.

## Consequences

- Updating the docs on the site means releasing; docs on `main` can run ahead of the site.
- If the apps server is down, so is the website; GitHub remains the fallback.
