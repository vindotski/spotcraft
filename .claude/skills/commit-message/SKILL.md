---
name: commit-message
description: Suggest a Conventional Commits message for the current changes in Spotcraft. Use when a step is finished and verified, or when the user asks for a commit message. The agent only suggests; the user commits.
---

# Commit message

The user commits. You never run `git commit`, `git push` or `git tag`. You suggest the message, and the user copies it.

## Steps

1. Read the change: `git status` and `git diff` (plus `git diff --staged` if anything is staged). Base the message on the diff, not on memory.
2. If the changes mix unrelated work, say so and propose how to split them into separate commits.
3. Output the message in one fenced code block, ready to paste. Nothing else goes in the block.

## Format

```
<type>(<scope>)<!>: <summary>

<body>

<footer>
```

- **Summary:** imperative and lower case, with no trailing period, **at most 50 characters**
  including the type and scope (72 is the hard limit). Count before suggesting.
- **Body (optional):** explains *why*, plus anything non-obvious. Wrap at 72 characters. Skip it for trivial changes.
- **Breaking changes:** add `!` after the scope, and a `BREAKING CHANGE: <what and how to migrate>` footer.
- Add no AI attribution or `Co-Authored-By` lines unless the user asks.

## Types

`feat`, `fix`, `refactor`, `perf`, `style` (formatting only), `test`, `docs`, `build` (toolchain, dependencies), `ci`, `chore` (repo housekeeping), `revert`.

## Scopes

Optional, but use one when it fits:

| Scope | Covers |
|---|---|
| `dashboard` | `apps/dashboard` |
| `site` | `apps/site` |
| `ui` | `packages/ui`: shared components and theme |
| `agent` | `agent/`: the deploy agent on the apps server |
| `infra` | `infra/`: compose, Caddy, cloud-init, OpenTofu |
| `docs` | `docs/`, ADRs |
| `deps` | dependency changes |
| `ci` | GitHub workflows |
| `ai` | `.claude/`, skills, `skills-lock.json` |
| `repo` | license, root config, repo metadata |

Leave the scope out for repo-wide changes.

## Example

```
feat(ui): add shared shadcn-svelte package

Both apps import @spotcraft/ui for components and the theme, so the
preset lives in one place instead of two copies.
```
