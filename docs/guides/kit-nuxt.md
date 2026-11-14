# Guest accounts in Nuxt

The backend kit's Nuxt adapter, `@spotcraft/kit/nuxt`, wires guest accounts, migrations and a
health check into a Nuxt 4 app (Nitro 2, h3 1). It imports nothing from Nuxt, so it needs no
extra install. Installing the kit, running it locally, keeping the guest's data and deploying
are as in [Guest accounts with the backend kit](backend-kit.md); this page is the Nuxt wiring.

## The backend

Create it on first use, so `nuxt build` needs no database:

```ts
// server/utils/backend.ts
import { type Backend, backendFromEnv } from '@spotcraft/kit'

let instance: Backend | undefined

export function backend(): Backend {
  instance ??= backendFromEnv() // DATABASE_URL, AUTH_SECRET, PUBLIC_URL
  return instance
}
```

## The guest, on every request

```ts
// server/middleware/guest.ts
import type { Guest } from '@spotcraft/kit'
import { guestMiddleware } from '@spotcraft/kit/nuxt'

declare module 'h3' {
  interface H3EventContext {
    /** The visitor's guest; null until they save something. */
    guest?: Guest | null
  }
}

export default defineEventHandler(guestMiddleware(backend))
```

- `event.context.guest` is the visitor's guest, or null. Reads (`GET`, `HEAD`) never create
  one; any other method does, so a guest exists once someone saves something.
- It sends the session cookie, and skips Nuxt's built files, the favicon and any path with a
  file extension (`skip` changes that).
- Over the guest limit it answers 429 itself, with `Retry-After` and a JSON body like Nuxt's
  errors.
- The client address is the last `X-Forwarded-For` entry, which Spotcraft's Caddy sets, or the
  connection's own address without one. An IPv6 address counts as its /64.

## Migrations and the start check

Bundle the migrations as server assets, since there's no folder at run time:

```ts
// nuxt.config.ts
nitro: {
  preset: 'node-server',
  serverAssets: [{ baseName: 'migrations', dir: './server/db/migrations' }],
},
```

```ts
// server/plugins/database.ts
import { migrationsFromFiles } from '@spotcraft/kit/migrate'
import { startup } from '@spotcraft/kit/nuxt'

export default defineNitroPlugin(async (nitroApp) => {
  if (import.meta.prerender || import.meta.dev) return
  const storage = useStorage('assets:migrations')
  const names = (await storage.getKeys()).filter((name) => name.endsWith('.sql'))
  const files = await Promise.all(
    names.map(async (name) => ({ name, sql: String(await storage.getItemRaw(name)) })),
  )
  await startup(nitroApp, backend, { migrations: migrationsFromFiles(files), adoptDrizzle: true })
})
```

- `startup` checks the database, applies the new migrations, then runs your `after` step, if
  you pass one. If any of that fails, the server exits naming the problem, so the deploy fails
  and the old version keeps serving. It closes the connections when the server stops.
- `drizzle-kit generate` writes the files (`0000_init.sql`, …). `adoptDrizzle` takes over a
  database that Drizzle's own migrator managed, once.
- The plugin skips dev and prerendering itself: Nitro replaces `import.meta.dev` only in the
  app's code. In dev, call `prepare(backend(), { migrations })` before the first query instead.

## The health check

```ts
// server/api/health.get.ts
import { healthResponse } from '@spotcraft/kit/nuxt'

export default defineEventHandler(() => healthResponse(backend()))
```

Point the image's `HEALTHCHECK` at `/api/health`. Nitro 2 starts serving before an async plugin
finishes, so the health check waits for `startup`: a deploy goes live only after the migrations
have run.
