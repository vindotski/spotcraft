import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { clientAddress, network } from './client.ts'
import { authSchemaVersion } from './provision.ts'
import { AUTH_SCHEMA_VERSION, accounts, sessions, users, verifications } from './schema.ts'

export { clientAddress, isGuestLimitError, network } from './client.ts'
export { accounts, sessions, users, verifications } from './schema.ts'
export { healthResponse, type PrepareOptions, prepare } from './start.ts'

/**
 * The backend kit for server-rendered apps (ADR 0016). Server-only: the browser never talks
 * to auth or the database, it only carries an httpOnly session cookie that the app's server
 * sets. No auth routes are mounted; Better Auth is used from server code only.
 */
export interface BackendOptions {
  /** The app's database, e.g. Spotcraft's DATABASE_URL. */
  databaseUrl: string
  /** The app's public address, e.g. `https://tagtape.app`; https except on localhost. */
  baseURL: string
  /** Signs session cookies; at least 32 characters. Changing it signs every guest out. */
  secret: string
  /** New guests one client address may create per window (default 30 per 10 minutes). */
  guestLimit?: { max: number; windowMs: number }
}

export interface Guest {
  id: string
  createdAt: Date
}

/** A client address created too many guests too quickly; answer 429. */
export class GuestLimitError extends Error {
  readonly status = 429
  readonly retryAfterSeconds: number
  constructor(retryAfterSeconds: number) {
    super('Too many new guests from this address; try again later')
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface Backend {
  /** Drizzle over the app's database; the app keeps its own tables in `public`. */
  db: NodePgDatabase
  /**
   * The visitor's guest, if they have one; never creates one. Use it for reading (page views,
   * GET requests), so favicons, parallel first requests and bots don't each make a guest that
   * nobody comes back to. Send `headers` with the response: they refresh the session cookie.
   */
  currentGuest(request: Request): Promise<{ guest: Guest | null; headers: Headers }>
  /**
   * The visitor's guest, created if they have none: use it when the visitor saves something
   * (form posts and other writes). Send `headers` with the response: they set the session
   * cookie. New guests are limited per client address (`GuestLimitError`).
   *
   * The address is `client.clientAddress` if given, else the last X-Forwarded-For entry,
   * which Spotcraft's Caddy sets (`clientAddress()`). An IPv6 address counts as its /64.
   */
  guest(
    request: Request,
    client?: { clientAddress?: string },
  ): Promise<{ guest: Guest; headers: Headers }>
  /**
   * Connects and checks that the `auth` schema is new enough for this kit, throwing an error
   * that names the problem. Call it when the server starts, so a wrong database stops the
   * deploy instead of the first save.
   */
  check(): Promise<void>
  /** Closes the database connections (on shutdown). */
  close(): Promise<void>
}

const DAY = 24 * 60 * 60

/** Fixed-window counter per client address, kept in memory (one process per app). */
function guestLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const windows = new Map<string, { start: number; count: number }>()
  return (address: string) => {
    const now = Date.now()
    if (windows.size > 10_000) {
      for (const [key, w] of windows) if (now - w.start >= windowMs) windows.delete(key)
    }
    const current = windows.get(address)
    if (!current || now - current.start >= windowMs) {
      windows.set(address, { start: now, count: 1 })
      return
    }
    if (current.count >= max) {
      throw new GuestLimitError(Math.ceil((current.start + windowMs - now) / 1000))
    }
    current.count++
  }
}

export function createBackend(options: BackendOptions): Backend {
  const pool = new pg.Pool({ connectionString: options.databaseUrl, max: 10 })
  // A pooled connection that breaks while idle (Postgres restarted, a network blip) is reported
  // here; with no listener it would crash the server. The pool opens a new one when needed.
  pool.on('error', (error) => console.error('Postgres connection lost:', error.message))
  const db = drizzle(pool)
  const auth = betterAuth({
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      // Better Auth's model names → Spotcraft's tables in the `auth` schema.
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    // Postgres generates the uuid ids (gen_random_uuid()).
    advanced: {
      database: { generateId: 'uuid' },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    // Guests keep their data as long as they keep coming back.
    session: { expiresIn: 365 * DAY, updateAge: DAY },
    plugins: [anonymous()],
    // No HTTP routes are mounted, so Better Auth's own limiter never runs; the kit limits
    // guest creation itself.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
  })
  const limit = guestLimiter(options.guestLimit ?? { max: 30, windowMs: 10 * 60_000 })

  // The auth schema is Spotcraft's: refuse to run against an older one (checked once).
  let ready: Promise<void> | undefined
  const checkSchema = () => {
    ready ??= (async () => {
      const client = await pool.connect().catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Can't connect to the app's database (DATABASE_URL): ${reason}`, {
          cause: error,
        })
      })
      try {
        const version = await authSchemaVersion(client)
        if (version < AUTH_SCHEMA_VERSION) {
          throw new Error(
            `The database's auth schema is at version ${version}, but this kit needs ${AUTH_SCHEMA_VERSION}. ` +
              'Upgrade Spotcraft (locally: spotcraft dev migrate).',
          )
        }
      } finally {
        client.release()
      }
    })().catch((error) => {
      ready = undefined
      throw error
    })
    return ready
  }

  /** The session's guest, if the request carries a valid one (refreshing it when due). */
  async function readGuest(request: Request) {
    await checkSchema()
    const current = await auth.api.getSession({ headers: request.headers, returnHeaders: true })
    const user = current.response?.user
    const guest = user ? { id: user.id, createdAt: new Date(user.createdAt) } : null
    return { guest, headers: current.headers }
  }

  return {
    db,
    currentGuest: readGuest,
    async guest(request, client) {
      const current = await readGuest(request)
      if (current.guest) return { guest: current.guest, headers: current.headers }
      limit(client?.clientAddress ? network(client.clientAddress) : clientAddress(request))
      const created = await auth.api.signInAnonymous({
        headers: request.headers,
        returnHeaders: true,
      })
      const { id, createdAt } = created.response.user
      return { guest: { id, createdAt: new Date(createdAt) }, headers: created.headers }
    },
    check: checkSchema,
    close: () => pool.end(),
  }
}

/**
 * `createBackend` from the environment: DATABASE_URL, AUTH_SECRET and PUBLIC_URL. Throws
 * naming the variable that is missing or wrong, so the app stops at start with a clear message.
 */
export function backendFromEnv(env: Record<string, string | undefined> = process.env): Backend {
  const databaseUrl = env.DATABASE_URL ?? ''
  if (!/^postgres(ql)?:\/\//.test(databaseUrl))
    throw new Error('DATABASE_URL must be a postgres:// URL')
  const secret = env.AUTH_SECRET ?? ''
  if (secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters')
  const baseURL = env.PUBLIC_URL ?? ''
  const url = URL.canParse(baseURL) ? new URL(baseURL) : undefined
  const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!url || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) {
    throw new Error("PUBLIC_URL must be the app's https:// address (http:// only for localhost)")
  }
  return createBackend({ databaseUrl, secret, baseURL: url.origin })
}
