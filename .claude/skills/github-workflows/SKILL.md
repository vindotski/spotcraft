---
name: github-workflows
description: Spotcraft's conventions for GitHub Actions workflows and Dependabot — SHA-pinned actions, least-privilege permissions, environments, OIDC publishing, branch triggers. Use when creating, editing or reviewing anything in .github/ (ci.yml, deploy.yml, pages.yml, dependabot.yml).
---

# GitHub workflows

## Branches and triggers

- `dev` is the default branch; PRs target it. `main` holds production; releases are tags
  `vX.Y.Z` on `main`.
- `ci.yml` runs on PRs, pushes to `main` and `v*.*.*` tags. Images are pushed only on push
  events; `latest` comes from `main` only.
- `deploy.yml` is manual (`workflow_dispatch` with an image tag) and uses the `production`
  environment.

## Rules

- **Pin every action to a full commit SHA** with the version in a comment, like the existing
  lines: `uses: actions/checkout@<40-hex sha> # v7.0.1`. Find the SHA for a tag with
  `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`. Reuse the SHA already used elsewhere in
  `.github/` for the same action. Dependabot (`github-actions` ecosystem) keeps them current.
- **Permissions:** `permissions: contents: read` at the top of each workflow; a job that needs
  more declares only that (e.g. `id-token: write` for npm trusted publishing or Pages, `pages:
  write` for Pages).
- `actions/checkout` with `persist-credentials: false` unless a later step needs to push.
- **Secrets and variables** belong to an environment (`production`, `npm`), not the repository.
  Pass them to steps through `env:`, never interpolate `${{ secrets.* }}` or untrusted input
  (`github.event.*`, inputs) directly into `run:` scripts. Validate inputs in a first step, as
  `deploy.yml` does for the tag.
- Node and pnpm come from the repo: `pnpm/action-setup` (version from `packageManager`) and
  `actions/setup-node` with `node-version-file: .nvmrc`.
- Only the original repository publishes (`github.repository == 'vindotski/spotcraft'`), so
  forks don't try.
- Set `concurrency` for anything that deploys or publishes, with `cancel-in-progress: false`.
- Comments at the top of a workflow say what it does and when it runs.

## Checking

There's no local runner. Check syntax with `actionlint` when it's installed (`brew install
actionlint`); otherwise read the diff carefully and let the PR's CI run prove it. A workflow
that only runs on `main` or tags can't be tested on a PR: say so to the user.
