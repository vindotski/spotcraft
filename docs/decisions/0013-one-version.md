---
title: One Semantic Version for the whole project
number: 13
status: superseded
implementation: done
date: 2026-11-07
supersedes: []
superseded_by: [19]
notes: ""
---

# One Semantic Version for the whole project

## Context

Spotcraft is a monorepo: an agent, a dashboard, a website, a UI package and infrastructure.
None of the packages is published to npm. The agent and dashboard images are deployed together,
under one tag, by one workflow, and the agent's API is only used by the dashboard of the same
release.

## Decision

- **One version** for everything, in the root `package.json`, following
  [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Every workspace package
  carries the same version; `pnpm check:versions` fails CI otherwise, and
  `node scripts/check-versions.ts <version>` sets them all.
- **The public API**, what a breaking change is measured against, is what an operator relies
  on: the names of the published images and their tags; the variables of the Deploy workflow
  and the `production` environment; the `.env` variables and Compose service names on each
  server, and the `/opt/spotcraft` layout; the OpenTofu module's variables and outputs; the
  agent's HTTP API; the format of the agent's `app.json` files. The dashboard's screens are not
  part of it.
- **0.y.z**: while the API settles, a breaking change raises the minor version (0.1 → 0.2) and
  a backwards-compatible change or fix raises the patch. 1.0.0 comes when the API is stable.
- **Changelog**: `CHANGELOG.md` in [Keep a Changelog 1.0.0](https://keepachangelog.com/en/1.0.0/)
  format, written for operators. Changes collect under `Unreleased`; a release renames that
  section to the version and date. Breaking changes include migration steps.
- **Releasing**: bump with the script, date the changelog, merge to `main`, tag `vX.Y.Z`. CI
  refuses a tag that doesn't match `package.json` and publishes images `X.Y.Z` and `X.Y`
  (plus `X` from 1.0 on). Deploy that tag with the Deploy workflow.

## Consequences

- One number answers "which Spotcraft is this server running?"
- A change to only the website still produces a new project version when released; releases
  are cut when there is something worth deploying, not per change.
