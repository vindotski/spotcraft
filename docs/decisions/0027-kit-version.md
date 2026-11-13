---
title: The kit has its own version
number: 27
status: accepted
implementation: done
date: 2026-11-13
supersedes: [19]
superseded_by: []
notes: "Partly supersedes ADR 0019: the kit no longer carries the project's version. The rest of 0019 (one version for everything else, the public API, 0.y.z rules, trusted publishing) stands. Built: kit-v* tags and their CI job, the release check, per-package pinning, the kit's changelog."
---

# The kit has its own version

## Context

ADR 0019 gives every package, including `@spotcraft/kit`, the project's one version. The kit
is a library that apps in other repositories install. Every Spotcraft release republished it,
so an infrastructure-only release still bumped the kit in every app, and the kit's version
said nothing about its own API.

What the kit really needs from a server is narrower than a Spotcraft version: its `auth` schema.
The server bundles a kit (the agent's `@spotcraft/kit/provision`, also used by the CLI) and
migrates every app database with it; the kit an app uses checks at runtime that the database's
`auth` schema is at least the version it needs (`AUTH_SCHEMA_VERSION`), and `provision` refuses
a database newer than it knows.

## Decision

- **`@spotcraft/kit` has its own Semantic Version** in `packages/kit/package.json`, its own
  `packages/kit/CHANGELOG.md`, and its own tags, `kit-vX.Y.Z`. A `kit-v*` tag publishes only the
  kit. It continues from 0.3.0.
- Everything else keeps the project's one version (ADR 0019), including the CLI, which mirrors
  the server's stack.
- **The contract is the `auth` schema.** A kit release that raises `AUTH_SCHEMA_VERSION` says in
  its changelog which Spotcraft version it needs. Order: release the kit, then the Spotcraft
  version that ships it, deploy, and only then upgrade apps. An app that upgrades first fails
  safe (the kit refuses to run until the schema catches up).
- **A Spotcraft release ships only a published kit.** CI refuses a `v*` tag unless the
  workspace kit's version is on npm and `packages/kit/src` is unchanged since its `kit-v` tag,
  so production never migrates with unpublished code. The CLI pins that exact kit version.

## Consequences

- Apps get kit updates only when the kit changes.
- Releasing a kit change takes two tags (kit, then Spotcraft) instead of one.
- Rolling Spotcraft back past a schema migration leaves app databases newer than the agent's
  kit: `provision` refuses them, so apps with a database can't deploy until Spotcraft is
  upgraded again.
