---
name: release
description: Prepare a Spotcraft release — version bump, changelog, release PR to main, tag instructions and what CI then publishes. Use when the user asks to cut, prepare or check a release, or to bump the version.
---

# Release

The process and what a version promises are in `docs/releasing.md` and ADR 0019; read both
first, they win over this skill. The user merges, tags and pushes; you prepare and check.

## Before

1. Work is merged into `dev`, CI is green there, and `CHANGELOG.md`'s `Unreleased` section
   covers everything since the last tag (`git log --oneline vX.Y.Z..origin/dev`).
2. Pick the version with Semantic Versioning at 0.y.z: a breaking change to the public API
   (ADR 0019's list: image names and tags, deploy variables, `.env` and Compose names, OpenTofu
   variables and outputs, the agent API, npm packages' names and exports, the CLI) raises the
   **minor**; anything else the **patch**. Say which entries make it breaking.
3. Breaking entries need migration steps in the changelog.

## Prepare (on a `release/X.Y.Z` branch from `dev`)

1. `node scripts/check-versions.ts X.Y.Z` sets every workspace package; `pnpm check:versions`
   confirms.
2. In `CHANGELOG.md`, rename `Unreleased` to `[X.Y.Z] - YYYY-MM-DD`, add a fresh empty
   `Unreleased`, and add the compare links at the bottom.
3. `pnpm verify` passes.
4. Suggest the commit (`chore(release): X.Y.Z`) and a PR **into `main`** with the changelog
   section as its body. After it merges, `main` must be merged back into `dev`.

## The user then

```bash
git tag -s vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z
```

CI verifies the tagged commit and publishes the images (`X.Y.Z`, `X.Y`) and the npm packages.
Then they run the Deploy workflow with the tag. Afterwards, check the CI run and the published
versions (`npm view spotcraft version`, `docker manifest inspect`), and tell the user what is
live. Never create or push tags yourself.
