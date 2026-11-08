---
title: One version for the project, including its npm packages
number: 19
status: accepted
implementation: done
date: 2026-11-08
supersedes: [13]
superseded_by: []
notes: "Restates ADR 0013 with the npm packages added: their names, their APIs as public API, and how they are published."
---

# One version for the project, including its npm packages

## Context

ADR 0013 gave the whole project one Semantic Version, with "nothing on npm". The backend kit
(ADR 0016) and the local stack (ADR 0017) change that. Apps install them from npm, in other
repositories, and they must match the Spotcraft the app is deployed to. The kit's `auth`
schema is migrated by Spotcraft and used by the kit.

## Decision

- **One version** for everything, in the root `package.json`, following
  [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Every workspace package
  carries it; `pnpm check:versions` fails CI otherwise, and `node scripts/check-versions.ts
  <version>` sets them all. The npm packages are published at that version too: kit X.Y.Z and
  CLI X.Y.Z belong to Spotcraft X.Y.Z, and the kit needs Spotcraft X.Y or later.
- **Two npm packages:**
  - `@spotcraft/kit`, in the npm org `spotcraft`.
  - `spotcraft`, the CLI, unscoped so that `npx spotcraft dev start` works as written.

  Every other workspace package stays private.
- **The public API**, what a breaking change is measured against, is what an operator or an
  app relies on:
  - the names of the published images and their tags;
  - the variables of the Deploy workflow and the `production` environment;
  - the `.env` variables and Compose service names on each server, and the `/opt/spotcraft`
    layout;
  - the OpenTofu module's variables and outputs;
  - the agent's HTTP API, and the format of its `app.json` files;
  - **new:** the npm package names; the kit's exports (`.`, `./schema`, `./provision`); the
    `auth` schema's tables and columns; `DATABASE_URL` and the role and database names it
    carries; and the CLI's commands and flags.

  The dashboard's screens are not part of it.
- **0.y.z**: while the API settles, a breaking change raises the minor version (0.1 → 0.2), and
  a backwards-compatible change or fix raises the patch. 1.0.0 comes when the API is stable.
- **Changelog**: `CHANGELOG.md` in [Keep a Changelog 1.0.0](https://keepachangelog.com/en/1.0.0/)
  format, for operators and app developers. Changes collect under `Unreleased`, and a release
  renames that section to the version and date. Breaking changes include migration steps.
- **Releasing**: bump with the script, date the changelog, merge to `main`, tag `vX.Y.Z`. CI
  refuses a tag that doesn't match `package.json` and publishes, from the same tested commit:
  - images `X.Y.Z` and `X.Y` (plus `X` from 1.0 on);
  - the two npm packages, `latest`, or `next` for a pre-release.

  Deploy that tag with the Deploy workflow.
- **npm publishing** runs in CI's `npm` job (environment `npm`) with **trusted publishing**:
  GitHub OIDC, no stored token, and provenance attached automatically.
  - Plain `npm publish` runs in each package's folder, after the build and after the CLI's
    `workspace:` dependency is pinned to the exact version. pnpm isn't used for publishing.
  - A version that is already on npm is skipped, so a re-run doesn't fail.
  - The first publish can't use OIDC, because a trusted publisher is linked to an existing
    package. It uses a short-lived `NPM_TOKEN` in the `npm` environment, with `--provenance`;
    the token is deleted once both packages are linked.

## Consequences

- One number answers "which Spotcraft is this server running?" and "which kit does it need?"
- A change to only the website still produces a new project version when released.
- An npm version can't be replaced: a broken release is fixed by a new patch version, and the
  broken one deprecated.
- The owner keeps the npm org `spotcraft` and the trusted-publisher links on npmjs.com.
