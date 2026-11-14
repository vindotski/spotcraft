# Guest accounts in TanStack Start

The backend kit's TanStack Start adapter, `@spotcraft/kit/tanstack-start`, wires guest
accounts, migrations and a health check into a TanStack Start app (React, on Nitro 3). It reads
the request from Start's request scope, so it works in server functions, server routes and
middleware. Installing the kit, running it locally, keeping the guest's data and deploying are
as in [Guest accounts with the backend kit](backend-kit.md); this page is the TanStack Start
wiring.

## The backend

Create it on first use, so building and prerendering need no database. Start bundles the server
twice (the app by Vite, Nitro's plugins by Nitro), so keep the one instance on `globalThis`:

```ts
// src/server/backend.server.ts
import { type Backend, backendFromEnv } from '@spotcraft/kit'
import { guestHelpers } from '@spotcraft/kit/tanstack-start'

const KEY = Symbol.for('my-app.backend')
const shared = globalThis as { [KEY]?: Backend }

export function backend(): Backend {
  shared[KEY] ??= backendFromEnv() // DATABASE_URL, AUTH_SECRET, PUBLIC_URL
  return shared[KEY]
}

export const { currentGuestId, guestId } = guestHelpers(backend)
```

## The guest, in server code

```ts
import { createServerFn } from '@tanstack/react-start'
import { currentGuestId, guestId } from './backend.server'

export const loadNotes = createServerFn().handler(async () => {
  const id = await currentGuestId() // null until they save something
  return id ? listNotes(id) : []
})

export const saveNote = createServerFn({ method: 'POST' }).handler(async () => {
  const id = await guestId() // creates the guest on their first save
  // …
})
```

- Both send the session cookie and mark the answer `Cache-Control: private, no-store`.
- `currentGuestId()` never creates a guest. Use it to read, so first visits and crawlers make
  none.
- Over the guest limit, `guestId()` sets `Retry-After` and throws the kit's `GuestLimitError`,
  and Start answers with its status, 429. To show your own message, catch it with `isGuestLimitError`.
- The client address is the last `X-Forwarded-For` entry, which Spotcraft's Caddy sets, or the
  connection's own address without one. An IPv6 address counts as its /64.

## Migrations and the start check

```ts
// src/server/startup.ts, listed in vite.config.ts: nitro({ plugins: ['src/server/startup.ts'] })
import { startup } from '@spotcraft/kit/tanstack-start'
import { definePlugin } from 'nitro'
import { backend } from './backend.server'
import { migrations } from './migrations'

export default definePlugin(async (nitroApp) => {
  if (import.meta.prerender || import.meta.dev) return
  await startup(nitroApp, backend, { migrations })
})
```

- `migrations` is a list of `{ version, name, sql }`, numbered from 1. Nitro bundles the plugin
  without Vite's `?raw`, so keep each migration's SQL in a module, or read `.sql` files from
  Nitro's server assets and pass them to `migrationsFromFiles`.
- `startup` checks the database, applies the new migrations, then runs your `after` step, if
  you pass one. If any of that fails, the server exits naming the problem, so the deploy fails
  and the old version keeps serving. Nitro holds requests until it is done, and `startup` closes
  the connections when the server stops.
- The plugin skips dev and prerendering itself: Nitro replaces `import.meta.dev` only in the
  app's code. In dev, call `prepare(backend(), { migrations })` before the first query instead.

## The health check

```ts
// src/routes/health.ts
import { healthResponse } from '@spotcraft/kit/tanstack-start'
import { createFileRoute } from '@tanstack/react-router'
import { backend } from '../server/backend.server'

export const Route = createFileRoute('/health')({
  server: { handlers: { GET: () => healthResponse(backend()) } },
})
```

Point the image's `HEALTHCHECK` at `/health`. It answers 503 until the database answers.
