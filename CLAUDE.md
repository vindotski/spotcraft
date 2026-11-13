# Spotcraft

Self-hosted deployment for a handful of web apps: Docker images behind HTTPS, monitored, managed
from one dashboard. One instance per owner, not SaaS. Design the smallest thing that works.

## Layout

| Path              | What                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `agent/`          | Fastify agent on the server: deploys apps (Compose + Caddy site blocks), Postgres per app, Cloudflare DNS |
| `apps/dashboard/` | SvelteKit dashboard; no database, asks the agent                                                          |
| `apps/site/`      | The website, spotcraft.dev (docs are this repo's Markdown)                                                |
| `packages/ui/`    | Shared shadcn-svelte components and theme                                                                 |
| `packages/kit/`   | `@spotcraft/kit` on npm: guest accounts and app databases for SSR apps                                    |
| `packages/cli/`   | `spotcraft` CLI on npm: local stack (`spotcraft dev`)                                                     |
| `infra/`          | Compose, Caddy, cloud-init, deploy script, OpenTofu (`hetzner`, `cloudflare`)                             |
| `docs/`           | Guides and ADRs (`docs/decisions/`), published on the website                                             |

Every package and `infra/*` folder has a README describing how it works **now**.

## Commands

```bash
pnpm verify      # check + versions + typecheck + test + build: run before calling work done
pnpm check       # Biome; `pnpm fix` writes fixes
pnpm --filter @spotcraft/dashboard test
```

Node from `.nvmrc`, pnpm from `packageManager`. Don't start dev servers (`pnpm dev`) in the
user's checkout without asking; they leave orphaned processes on 3000/5173.

## Conventions

- **Branches:** `dev` is the default; branch from it and open PRs into it. `main` is production;
  releases are `vX.Y.Z` tags on `main` (`docs/releasing.md`, skill `release`).
- **Commits and PRs:** commit each finished, verified step with a Conventional Commits message
  (skill `commit-message`), push the branch and open a PR into `dev`. Never force-push, push to
  `dev` or `main` directly, tag, or merge: the user merges and tags.
- **Decisions** get an ADR in `docs/decisions/` (skill `adr`); a changed decision gets a new ADR
  that supersedes the old one.
- **Docs move with the code:** update the package README and the `Unreleased` section of
  `CHANGELOG.md` in the same change. Breaking changes need migration steps.
- **One version** for the project (ADR 0019), set with `node scripts/check-versions.ts`.
- **Workflows:** actions pinned to commit SHAs, least-privilege permissions (skill
  `github-workflows`).
- **Supply chain:** pinned image digests in Compose files, pinned CLIs (`pnpm exec`, not `npx`),
  `minimumReleaseAge` in `pnpm-workspace.yaml`.
- Plain, short sentences in docs and comments.
