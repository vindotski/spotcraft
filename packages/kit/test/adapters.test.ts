// The framework adapters, each in a small app on the real framework code (h3 1 for Nuxt,
// TanStack Start's request scope), against a real Postgres (see provision.test.ts): skipped
// without KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it, mock } from 'node:test'
import {
  createServerEntry,
  getResponseHeaders,
  getResponseStatus,
} from '@tanstack/react-start/server'
import { sql } from 'drizzle-orm'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import pg from 'pg'
import { type Backend, createBackend, type Guest } from '../src/index.ts'
import { guestMiddleware } from '../src/nuxt.ts'
import { appDatabaseName, provision, purge } from '../src/provision.ts'
import { healthResponse, prepare, startup } from '../src/start.ts'
import { guestHelpers } from '../src/tanstack-start.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'kit_adapter_admin'
const ADMIN_PASSWORD = 'adapter-admin-password-0123456789'
const APP = 'kit-adapter'
const APP_PASSWORD = 'kit-adapter-password-0123456789'
const SECRET = 'a-test-secret-that-is-long-enough-0123456789'

function urlFor(user: string, password: string, database: string) {
  const url = new URL(SUPERUSER_URL as string)
  url.username = user
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}
const adminUrl = () => urlFor(ADMIN, ADMIN_PASSWORD, 'postgres')
const appUrl = (password = APP_PASSWORD) =>
  urlFor(appDatabaseName(APP), password, appDatabaseName(APP))

const backends: Backend[] = []
function newBackend(options: { databaseUrl?: string; max?: number } = {}) {
  const backend = createBackend({
    databaseUrl: options.databaseUrl ?? appUrl(),
    baseURL: 'http://localhost:3000',
    secret: SECRET,
    guestLimit: { max: options.max ?? 100, windowMs: 60_000 },
  })
  backends.push(backend)
  return backend
}
/** The cookie header a browser would send back, from a response's Set-Cookie. */
const cookieFrom = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

describe('framework adapters', {
  skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set',
}, () => {
  before(async () => {
    const su = new pg.Client({ connectionString: SUPERUSER_URL })
    await su.connect()
    await su.query(`DROP ROLE IF EXISTS ${ADMIN}`)
    await su.query(`CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
    await su.end()
    await purge(adminUrl(), APP)
    await provision(adminUrl(), { name: APP, password: APP_PASSWORD })
  })
  after(async () => {
    if (!SUPERUSER_URL) return
    await Promise.all(backends.map((backend) => backend.close().catch(() => {})))
    await purge(adminUrl(), APP)
    const su = new pg.Client({ connectionString: SUPERUSER_URL })
    await su.connect()
    await su.query(`DROP ROLE IF EXISTS ${ADMIN}`)
    await su.end()
  })

  describe('Nuxt (h3 1)', () => {
    let server: Server
    let base: string
    let limited: Backend

    before(async () => {
      const backend = newBackend()
      limited = newBackend({ max: 1 })
      const app = createApp()
      app.use(
        defineEventHandler((event) => {
          const middleware = event.path.startsWith('/limited')
            ? guestMiddleware(() => limited)
            : guestMiddleware(() => backend)
          return middleware(event)
        }),
      )
      const router = createRouter()
      const answer = defineEventHandler((event) => {
        const guest: Guest | null | undefined = event.context.guest
        return { guest: guest?.id ?? null }
      })
      router.use('/**', answer)
      app.use(router)
      server = createServer(toNodeListener(app))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    after(() => new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()))

    it('creates a guest only on a write, then knows them on reads', async () => {
      const read = await fetch(`${base}/levels`)
      assert.deepEqual(await read.json(), { guest: null })
      assert.deepEqual(read.headers.getSetCookie(), [])

      const write = await fetch(`${base}/levels/1/complete`, { method: 'POST' })
      const { guest } = (await write.json()) as { guest: string }
      assert.match(guest, /^[0-9a-f-]{36}$/)
      const cookie = write.headers.getSetCookie().find((c) => c.includes('session_token='))
      assert.match(cookie ?? '', /HttpOnly/i)

      const again = await fetch(`${base}/me`, { headers: { cookie: cookieFrom(write.headers) } })
      assert.deepEqual(await again.json(), { guest })
    })

    it('skips assets', async () => {
      const asset = await fetch(`${base}/_nuxt/entry.js`, { method: 'POST' })
      assert.deepEqual(await asset.json(), { guest: null })
      assert.deepEqual(asset.headers.getSetCookie(), [])
    })

    it('answers the guest limit with 429 and Retry-After, per forwarded /64', async () => {
      const from = (address: string) => ({
        method: 'POST',
        headers: { 'x-forwarded-for': `6.6.6.6, ${address}` },
      })
      assert.equal((await fetch(`${base}/limited`, from('2001:db8:5::1'))).status, 200)
      const over = await fetch(`${base}/limited`, from('2001:db8:5::2'))
      assert.equal(over.status, 429)
      assert.ok(Number(over.headers.get('retry-after')) > 0)
      assert.equal(((await over.json()) as { statusCode: number }).statusCode, 429)
      assert.equal((await fetch(`${base}/limited`, from('2001:db8:6::1'))).status, 200)
    })
  })

  describe('TanStack Start', () => {
    /** A Start server entry that runs `fn` in its request scope and reports what it set. */
    function entryFor(fn: () => Promise<unknown>) {
      return createServerEntry({
        async fetch() {
          const value = await fn()
          return Response.json({
            value,
            status: getResponseStatus(),
            headers: Object.fromEntries(getResponseHeaders().entries()),
            cookies: getResponseHeaders().getSetCookie(),
          })
        },
      })
    }

    it('reads without creating, and creates on a save', async () => {
      const { currentGuestId, guestId } = guestHelpers(() => backend)
      const backend = newBackend()
      const read = await entryFor(currentGuestId).fetch(new Request('http://localhost/'))
      const readBody = (await read.json()) as { value: null; headers: Record<string, string> }
      assert.equal(readBody.value, null)
      assert.equal(readBody.headers['cache-control'], 'private, no-store')

      const save = await entryFor(guestId).fetch(
        new Request('http://localhost/', { method: 'POST' }),
      )
      const saved = (await save.json()) as { value: string; cookies: string[] }
      assert.match(saved.value, /^[0-9a-f-]{36}$/)
      const cookie = saved.cookies.map((c) => c.split(';')[0]).join('; ')
      assert.ok(cookie.includes('session_token='))

      const again = await entryFor(currentGuestId).fetch(
        new Request('http://localhost/', { headers: { cookie } }),
      )
      assert.equal(((await again.json()) as { value: string }).value, saved.value)
    })

    it('answers the guest limit with 429 and Retry-After', async () => {
      const backend = newBackend({ max: 1 })
      const { guestId } = guestHelpers(() => backend)
      const post = () =>
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.9' },
        })
      assert.equal((await entryFor(guestId).fetch(post())).status, 200)
      const over = await entryFor(guestId).fetch(post())
      assert.equal(over.status, 429)
      assert.ok(Number(over.headers.get('retry-after')) > 0)
    })
  })

  describe('startup, prepare and health', () => {
    const NOTES = [{ version: 1, name: 'notes', sql: 'CREATE TABLE notes (id int)' }]

    it('prepares once: checks, migrates, then runs the app step', async () => {
      const backend = newBackend()
      let after = 0
      const options = { migrations: NOTES, after: async () => void after++ }
      await Promise.all([prepare(backend, options), prepare(backend, options)])
      await prepare(backend, options)
      assert.equal(after, 1)
      const { rows } = await backend.db.execute<{ found: boolean }>(
        sql`SELECT to_regclass('public.notes') IS NOT NULL AS found`,
      )
      assert.equal(rows[0].found, true)
    })

    it('tries again after a failure', async () => {
      const backend = newBackend()
      let calls = 0
      const after = async () => {
        calls++
        if (calls === 1) throw new Error('first time')
      }
      await assert.rejects(prepare(backend, { after }), /first time/)
      await prepare(backend, { after })
      assert.equal(calls, 2)
    })

    it('startup closes the backend on close, and exits when the database is wrong', async (t) => {
      const hooks: (() => unknown)[] = []
      const nitroApp = { hooks: { hook: (_: 'close', fn: () => unknown) => hooks.push(fn) } }
      const good = newBackend()
      await startup(nitroApp, () => good)
      assert.equal(hooks.length, 1)

      const exit = t.mock.method(process, 'exit', () => undefined as never)
      const logged = t.mock.method(console, 'error', () => {})
      const wrong = newBackend({ databaseUrl: appUrl('not-the-password') })
      await startup(nitroApp, () => wrong)
      assert.deepEqual(exit.mock.calls[0]?.arguments, [1])
      assert.match(
        String(logged.mock.calls[0]?.arguments[1]),
        /Can't connect to the app's database/,
      )
      mock.restoreAll()
    })

    it('health waits for a prepare under way, and fails after a failed one', async (t) => {
      const backend = newBackend()
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const preparing = prepare(backend, { after: () => held })
      let answered = false
      const health = healthResponse(backend).then((response) => {
        answered = true
        return response
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(answered, false)
      release()
      await preparing
      assert.equal((await health).status, 200)

      t.mock.method(console, 'error', () => {})
      const failing = newBackend()
      await assert.rejects(prepare(failing, { after: async () => Promise.reject(new Error('no')) }))
      assert.equal((await healthResponse(failing)).status, 503)
      await prepare(failing)
      assert.equal((await healthResponse(failing)).status, 200)
    })

    it('health answers 200, or 503 without saying why', async (t) => {
      const ok = await healthResponse(newBackend())
      assert.equal(ok.status, 200)
      assert.deepEqual(await ok.json(), { ok: true })
      t.mock.method(console, 'error', () => {})
      const down = await healthResponse(newBackend({ databaseUrl: appUrl('not-the-password') }))
      assert.equal(down.status, 503)
      assert.deepEqual(await down.json(), { ok: false })
    })
  })
})
