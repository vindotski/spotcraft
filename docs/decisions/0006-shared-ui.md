---
title: Shared UI package with shadcn-svelte
number: 6
status: accepted
implementation: skeleton
date: 2026-11-07
supersedes: []
superseded_by: []
notes: ""
---

# Shared UI package with shadcn-svelte

## Context

The dashboard and the website should look like one product. shadcn-svelte copies component
source into a project rather than installing a library, so two apps would otherwise hold two
copies of every component and the theme.

## Decision

- One workspace package, `packages/ui` (`@spotcraft/ui`), holds the shadcn-svelte
  `components.json`, the components, `cn`, and the theme in `styles.css`.
- The theme is the shadcn-svelte preset `b6RdvRWulu` (`vega` style, neutral, square corners,
  Space Grotesk, lucide icons).
- Both apps use Tailwind v4 and import `@spotcraft/ui/styles.css`; that file declares an
  `@source` for the package's components so each app's Tailwind generates their classes.
- The package is source-only; the apps compile it. Inside it, files import each other through
  `#ui/*` package imports.

## Consequences

- Components are added once, with the CLI run in `packages/ui`.
- The CLI lists component dependencies as dev dependencies; they have to be moved to
  `dependencies` so the apps get them.
