# @spotcraft/site

The Spotcraft website, [spotcraft.dev](https://spotcraft.dev): a home page and the
documentation. Plain [Astro](https://astro.build) with no UI framework and no client-side
JavaScript, published on GitHub Pages
([ADR 0024](../../docs/decisions/0024-website-on-pages.md)).

## How it works

- **Pages** (`src/pages/`): `/` (home), `/docs`, every docs page at `/docs/<slug>`, and
  `404.html` for GitHub Pages. Built as `x.html` files (`build.format: 'file'`), which Pages
  serves at `/x`.
- **Docs** are the repository's own Markdown, read at build time (`src/lib/docs.ts`):
  `docs/getting-started.md`, `docs/security.md`, `docs/guides/backend-kit.md`, the decision
  records and `CHANGELOG.md`. Links between those files become site links; any other repository
  path links to GitHub at the release tag.
- **Styling**: Tailwind v4 through `@tailwindcss/vite`, with the theme from
  `@spotcraft/ui/styles.css`, so it matches the dashboard. Dark mode follows the system.
- **Content-Security-Policy**: a meta tag with `script-src 'none'` (`src/layouts/Base.astro`).
- **Static files** (`public/`): `CNAME`, `robots.txt`, the favicon and the dashboard screenshots.

## Build

```sh
pnpm --filter @spotcraft/site build      # astro build → dist/, then the link check
pnpm --filter @spotcraft/site typecheck  # astro check
```

The build fails when a page the site has always had is missing, an internal link or `#anchor`
doesn't resolve, or a page contains a `<script>` (`scripts/check-links.ts`).

## Deploy

`.github/workflows/pages.yml` builds `dist/` on every push to `main` that touches the site,
the docs or the changelogs, and deploys it with GitHub Pages. In the repository's settings,
Pages uses "GitHub Actions" as its source and `spotcraft.dev` as its custom domain, and the
`github-pages` environment allows deploys from `main`. DNS: the apex has GitHub Pages' A and
AAAA records and `www` is a CNAME to `vindotski.github.io`, all DNS-only in Cloudflare.
