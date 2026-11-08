# Guest accounts with the backend kit

The backend kit, `@spotcraft/kit`, gives a server-rendered app **guest accounts**. A visitor
gets an account the first time they save something, without signing up, and the app keeps their
data under its id. The data lives in the app's own Postgres database on the apps server. Locally, the
`spotcraft dev` command runs the same setup. Why it works this way is in
[ADR 0016](../decisions/0016-backend-kit.md) and [ADR 0017](../decisions/0017-local-stack.md).

This guide uses SvelteKit 3. Any server framework works that gives you the incoming
`Request` and lets you add headers to the response.

## Install

```bash
npm install @spotcraft/kit drizzle-orm
npm install --save-dev spotcraft
```

Use the same version as the Spotcraft you deploy to. The kit refuses to start against an older
`auth` schema.

## Run it locally

You need Docker.

```bash
npx spotcraft dev start         # one local Postgres for all your apps, and this app's database
npx spotcraft dev env --write   # adds DATABASE_URL and AUTH_SECRET to .env, if missing
echo 'PUBLIC_URL=http://localhost:5173' >> .env
```

`npx spotcraft dev stop` stops Postgres; the data stays. `npx spotcraft dev reset` starts the
app's database empty again.

## Wire it into SvelteKit

**Declare the three settings** so SvelteKit reads them, from `.env` in development and from the
environment in production. The kit checks the values itself.

```ts
// src/env.ts
import { defineEnvVars } from '@sveltejs/kit/env'

const text = (value: string | undefined) => value ?? ''

export const variables = defineEnvVars({
  DATABASE_URL: { description: 'Postgres for this app (Spotcraft sets it)', schema: text },
  AUTH_SECRET: { description: 'Signs session cookies, 32+ characters', schema: text },
  PUBLIC_URL: { description: "The app's address", schema: text },
})
```

**Create the backend on first use**, in server-only code. `vite build` imports the file without
a database, so the backend can't be created when the module loads.

```ts
// src/lib/server/backend.ts
import { type Backend, backendFromEnv } from '@spotcraft/kit'
import { AUTH_SECRET, DATABASE_URL, PUBLIC_URL } from '$app/env/private'

let instance: Backend | undefined

export function backend(): Backend {
  instance ??= backendFromEnv({ DATABASE_URL, AUTH_SECRET, PUBLIC_URL })
  return instance
}
```

**Look up the visitor's guest in a hook, and create one only on writes.** Reads (`GET`,
`HEAD`) use `currentGuest`, which never creates a guest. The first write (a form post) uses
`guest()`, which creates one if needed. If every request created a guest, a first visit would
make several: the page and its parallel requests, such as `/favicon.ico`, each arrive before the
cookie exists. Every crawler would make one too, and nobody would ever come back to them.
**Copy the kit's headers onto the response**: they set the session cookie and renew it.

```ts
// src/hooks.server.ts
import { GuestLimitError } from '@spotcraft/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { backend } from '#lib/server/backend.ts'

export const handle: Handle = async ({ event, resolve }) => {
  const kit = backend()
  const reading = event.request.method === 'GET' || event.request.method === 'HEAD'
  let session
  try {
    session = reading
      ? await kit.currentGuest(event.request)
      : await kit.guest(event.request, { clientAddress: event.getClientAddress() })
  } catch (error) {
    if (error instanceof GuestLimitError) {
      return new Response('Too many new visitors; try again soon.', {
        status: 429,
        headers: { 'retry-after': String(error.retryAfterSeconds) },
      })
    }
    throw error
  }
  event.locals.guest = session.guest
  const response = await resolve(event)
  for (const cookie of session.headers.getSetCookie()) response.headers.append('set-cookie', cookie)
  return response
}
```

Type `event.locals.guest` as `Guest | null` (the kit's `Guest`) in `src/app.d.ts`: it is
`null` until the visitor saves something. SvelteKit 3 has no `$lib` alias; the snippets use
the `#lib/*` import from `package.json` (`"imports": { "#lib/*": "./src/lib/*" }`).

**Import the kit only from server code**: hooks, `+page.server.ts`, `+server.ts`, and server-only
modules. A client bundle that imports it fails to build. The browser never talks to auth or the
database; it only carries the session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on https).

## Keep the guest's data

Keep the app's data in the app's own tables in `public`, keyed by the user's id with a
foreign key to `auth.users`. Deleting a user then deletes their rows too. Don't add columns to
`auth.*`: Spotcraft owns that schema and the app's role can't change it.

```ts
import { users } from '@spotcraft/kit/schema'
import { pgTable, serial, text, uuid } from 'drizzle-orm/pg-core'

export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
})
```

```ts
// src/routes/+page.server.ts
export const load = async ({ locals }) => {
  if (!locals.guest) return { notes: [] } // hasn't saved anything yet
  const { db } = backend()
  return { notes: await db.select().from(notes).where(eq(notes.userId, locals.guest.id)) }
}

export const actions = {
  // A form post: the hook has created the guest if this is their first write.
  default: async ({ request, locals }) => {
    const body = String((await request.formData()).get('body') ?? '')
    await backend().db.insert(notes).values({ userId: locals.guest!.id, body })
  },
}
```

The app runs its own migrations for `public`, for example with drizzle-kit.

## Deploy it on Spotcraft

1. **Build the image for running behind Caddy.** Spotcraft's Caddy sends the real protocol
   and client address in `X-Forwarded-*` headers. With adapter-node, set:

   ```dockerfile
   ENV PROTOCOL_HEADER=x-forwarded-proto ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1
   ```

   Without `ADDRESS_HEADER`, every visitor seems to come from Caddy. The limit on new guests
   (30 per address per 10 minutes) would then apply to all of them together. Without
   `PROTOCOL_HEADER`, form posts are refused as cross-site.
2. **In the dashboard**, add or edit the app and tick **Database**. Spotcraft creates the app's
   database and sets `DATABASE_URL`; don't set it yourself.
3. **Add two environment variables**: `AUTH_SECRET` (`openssl rand -hex 32`, never the local
   one) and `PUBLIC_URL`, the app's `https://` address.

Redeploys keep the data: it lives in Postgres, not in the container. Removing the app in the
dashboard keeps its database too, unless you also choose to delete it.

## Good to know

- A guest is tied to their browser's cookie. Clearing cookies or switching device starts a new
  guest, and the old data can't be reached until sign-up exists.
- Sessions last a year and renew on use. Changing `AUTH_SECRET` signs every guest out.
- Guests get the name "Anonymous" and a placeholder email; the id is what to use.
- New guests are limited to 30 per client address per 10 minutes. Returning guests never are.
  Pass `guestLimit` to `createBackend` to change it.
- Only writes create guests, so the users list in the dashboard shows visitors who saved
  something, not every page view or crawler.
