---
name: astro-site
description: How Spotcraft's website (apps/site, spotcraft.dev) is built with Astro — static output, no UI framework, docs rendered from the repository's Markdown, Tailwind v4, GitHub Pages. Use when creating, editing or debugging anything in apps/site, its build, its link check or its Pages deployment.
---

# Astro site (apps/site)

> Target setup from the planned move to Astro and GitHub Pages. While `apps/site` still has a
> `svelte.config`/SvelteKit routes, that move hasn't landed: treat this as the spec for it.

The website is plain **Astro with no UI framework integration** (no React, Vue or Svelte) and
**no client-side JavaScript**. Everything is rendered at build time and served by GitHub Pages
at the domain root (`public/CNAME` = `spotcraft.dev`).

## Rules

- **`.astro` components only.** Don't add `@astrojs/svelte`/`react`/… or `client:*`
  directives. If something seems to need JavaScript, ask first: the CSP has no `script-src`
  allowances for it.
- **Static output:** `output: 'static'`, `site: 'https://spotcraft.dev'`,
  `build.format: 'directory'` (`/docs/x` → `dist/docs/x/index.html`). No adapter, no SSR,
  no `prerender = false`.
- **Pages** live in `src/pages/`. Dynamic routes export `getStaticPaths()`; an unknown slug has
  no page, and `src/pages/404.astro` becomes `dist/404.html`, which GitHub Pages serves.
- **Active links** come from `Astro.url.pathname`, computed at build time.
- **Raw HTML** from the Markdown renderer goes in with `<Fragment set:html={html} />`. Only
  render the repository's own Markdown that way, never fetched content.
- **Docs content** is the repository's Markdown (`docs/**/*.md`, `CHANGELOG.md`, package
  changelogs), loaded in `src/lib/docs.ts` with `import.meta.glob(..., { query: '?raw',
  import: 'default', eager: true })` and rendered with `marked`. Links between repo files are
  rewritten to `/docs/<page>`, other repo paths to GitHub at the release tag
  (`GITHUB_AT_VERSION` in `src/lib/site.ts`).
- **Styling:** Tailwind v4 through `@tailwindcss/vite` in `vite.plugins`, and the global CSS
  imports `@spotcraft/ui/styles.css` (plain CSS: theme tokens), so the site matches the
  dashboard. Components from `@spotcraft/ui` are Svelte and can't be used; copy their Tailwind
  classes onto plain elements instead.
- **CSP:** a static `<meta http-equiv="Content-Security-Policy">` in the base layout. Pages can't
  send headers, so `frame-ancestors` isn't possible (a meta CSP ignores it). Keep the build free
  of `<script>` tags; check with `grep -rl '<script' dist/`.

## Commands

From the repository root (never start a dev server in the user's checkout without asking):

```bash
pnpm --filter @spotcraft/site build      # astro build → apps/site/dist
pnpm --filter @spotcraft/site typecheck  # astro check
```

After a build, the link check must pass: every old URL still exists and every internal link
and `#anchor` resolves. It runs in `pnpm verify`.

## Deployment

`.github/workflows/pages.yml` builds on pushes to `main` and deploys `apps/site/dist` with
`actions/upload-pages-artifact` + `actions/deploy-pages`. The repository's Pages source is
"GitHub Actions". `main` is production, so the site shows the released docs.

Look up anything else in the Astro docs for the installed version (`pnpm --filter
@spotcraft/site exec astro --version`); APIs differ between majors.
