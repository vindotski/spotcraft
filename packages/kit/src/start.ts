import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Backend } from './index.ts'
import { type Migration, migrateApp } from './migrate.ts'

/*
 * Getting an app's database ready when its server starts, for any framework (ADR 0031).
 */

export interface PrepareOptions {
  /** The app's own migrations (`@spotcraft/kit/migrate`). */
  migrations?: readonly Migration[]
  /** Take over a database Drizzle's migrator managed (`migrateApp`). */
  adoptDrizzle?: boolean
  /** The app's own step once migrated, such as writing fixed data. */
  after?: (db: NodePgDatabase) => Promise<void>
}

// On the backend itself, under a global symbol, so two bundled copies of the kit share it.
const PREPARED = Symbol.for('spotcraft.kit.prepared')
const FAILED = Symbol.for('spotcraft.kit.prepareFailed')
type Prepared = Backend & { [PREPARED]?: Promise<void>; [FAILED]?: unknown }

/**
 * Checks the database (`backend.check()`), applies the app's migrations, then runs `after`.
 * Runs once per backend; every caller waits for the same run, and a failure is tried again by
 * the next caller. Call it at start, or before the first query in development.
 */
export function prepare(backend: Backend, options: PrepareOptions = {}): Promise<void> {
  const target = backend as Prepared
  target[PREPARED] ??= (async () => {
    await backend.check()
    if (options.migrations) {
      await migrateApp(backend.db, options.migrations, { adoptDrizzle: options.adoptDrizzle })
    }
    await options.after?.(backend.db)
    target[FAILED] = undefined
  })().catch((error: unknown) => {
    target[PREPARED] = undefined
    target[FAILED] = error
    throw error
  })
  return target[PREPARED]
}

/** What `startup` needs of a Nitro app (Nitro 2 and 3 alike). */
export interface NitroAppLike {
  hooks: { hook(name: 'close', fn: () => unknown): unknown }
}

/**
 * For a Nitro server plugin: prepares the database, and closes its connections when the server
 * shuts down. If preparing fails, the process exits naming the problem, so the deploy's health
 * check fails and the previous version keeps serving. Nitro 3 holds requests until it is done;
 * Nitro 2 doesn't, so have the health check use `healthResponse`, which waits for it.
 *
 * Skip it while prerendering and in development, in the app's own plugin: Nitro replaces
 * `import.meta.prerender` and `import.meta.dev` only in the app's code.
 */
export async function startup(
  nitroApp: NitroAppLike,
  backend: () => Backend,
  options: PrepareOptions = {},
): Promise<void> {
  nitroApp.hooks.hook('close', () => backend().close())
  try {
    await prepare(backend(), options)
  } catch (error) {
    console.error('The server cannot start:', error)
    process.exit(1)
  }
}

/**
 * The answer to a health check: 200 `{"ok":true}` once the database answers, else 503 (the
 * reason goes to the log, not the response). Return it from the app's health route.
 *
 * It waits for a `prepare` (or `startup`) under way, and fails while the last one failed. Nitro 2
 * doesn't wait for an async plugin before it serves, so this is what keeps a deploy from going
 * live before the migrations have run.
 */
export async function healthResponse(backend: Backend): Promise<Response> {
  const headers = { 'cache-control': 'no-store' }
  const target = backend as Prepared
  try {
    await target[PREPARED]
    if (target[FAILED]) throw target[FAILED]
    await backend.check()
    await backend.db.execute(sql`SELECT 1`)
    return Response.json({ ok: true }, { headers })
  } catch (error) {
    console.error('Health check failed:', error)
    return Response.json({ ok: false }, { status: 503, headers })
  }
}
