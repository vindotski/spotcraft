---
title: The website is plain Astro, published on GitHub Pages
number: 24
status: accepted
implementation: done
date: 2026-11-13
supersedes: [14]
superseded_by: []
notes: "Partly supersedes ADR 0014: how the site is built and where it is hosted. Its content rules (home page plus docs, docs from the repository, dark mode from the system) stand. Built: Astro site, link check, Pages workflow; the DNS switch happens at go-live."
---

# The website is plain Astro, published on GitHub Pages

## Context

ADR 0014 made spotcraft.dev a fully prerendered SvelteKit site, shipped as a Node image and
hosted as an app on Spotcraft's own apps server. It has no server-side logic and ships no
client-side JavaScript. Running it as a container costs memory on the apps server, an image
to build and scan on every release, and a deploy step; and the site goes down with the
server it documents.

## Decision

- **Astro, with no UI framework**: plain `.astro` components, Tailwind v4 through Vite, and
  the shared theme from `@spotcraft/ui/styles.css`. `@spotcraft/ui`'s Svelte components are
  not used; the few the site needs are copied as Tailwind classes.
- **Static output**: `build.format: 'file'`, so `/docs/x` is `docs/x.html` and the URLs stay
  as they were. No client-side JavaScript; the Content-Security-Policy is a meta tag with
  `script-src 'none'` (Pages can't send headers, so there's no `frame-ancestors`).
- **A build check** fails the build if a page the site has always had is missing, an internal
  link or `#anchor` doesn't resolve, or any page has a `<script>`.
- **GitHub Pages**, deployed by `.github/workflows/pages.yml` on every push to `main`, which
  holds the released version, so the site shows the released docs. The repository's Pages
  source is GitHub Actions and its custom domain `spotcraft.dev`; DNS points at GitHub's
  Pages addresses, not proxied by Cloudflare.
- The `spotcraft-site` image is no longer built or published.

## Consequences

- The website no longer depends on the apps server, and the server has one app less.
- Pages can't send headers: no HSTS from the site itself and no `frame-ancestors`.
- A change to the site or the docs on `main` is live within minutes, without a release.
- Two front-end stacks in the repository: SvelteKit for the dashboard, Astro for the site.
