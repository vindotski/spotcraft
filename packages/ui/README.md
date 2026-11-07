# @spotcraft/ui

Shared UI for `apps/dashboard` and `apps/site`: [shadcn-svelte](https://shadcn-svelte.com)
components and the theme (preset `b6RdvRWulu`: the `vega` style, neutral colors, square
corners, Space Grotesk, lucide icons). Source-only: the apps compile it, there is no build.

## Use it in an app

```css
/* src/routes/layout.css */
@import "@spotcraft/ui/styles.css";
```

```svelte
<script lang="ts">
  import { Button } from '@spotcraft/ui/components/button'
  import * as Card from '@spotcraft/ui/components/card'
</script>
```

The app needs Tailwind v4 (`@tailwindcss/vite`) and `"@spotcraft/ui": "workspace:*"`.
`styles.css` carries an `@source` for this package's components, so the app's Tailwind
generates their classes.

| Export                | What                                    |
| --------------------- | --------------------------------------- |
| `./styles.css`        | Tailwind, theme variables, fonts        |
| `./components/<name>` | a component (`button`, `card`)          |
| `./utils`             | `cn` and the shadcn-svelte helper types |

Inside the package, files import each other through `#ui/*` (package `imports`).

## Add a component

```sh
cd packages/ui
pnpm dlx shadcn-svelte@latest add <component> -y --no-deps-install
```

Then move any dependencies the CLI added from `devDependencies` to `dependencies` (the apps
need them installed) and run `pnpm install` from the root.

```sh
pnpm --filter @spotcraft/ui typecheck
```
