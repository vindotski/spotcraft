// Guests against a real Postgres (see provision.test.ts): skipped without
// KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import pg from 'pg'
import { backendFromEnv, createBackend, GuestLimitError } from '../src/index.ts'
import { appDatabaseName, provision, purge } from '../src/provision.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'kit_guest_admin'
const ADMIN_PASSWORD = 'guest-admin-password-0123456789'
const APP = 'kit-guest'
const APP_PASSWORD = 'kit-guest-password-0123456789'
const SECRET = 'a-test-secret-that-is-long-enough-0123456789'

function urlFor(user: string, password: string, database = 'postgres') {
  const url = new URL(SUPERUSER_URL as string)
  url.username = user
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}
const adminUrl = () => urlFor(ADMIN, ADMIN_PASSWORD)
const appUrl = () => urlFor(appDatabaseName(APP), APP_PASSWORD, appDatabaseName(APP))

async function query<T extends pg.QueryResultRow>(
  url: string,
  sql: string,
  params: unknown[] = [],
) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query<T>(sql, params)
  } finally {
    await client.end()
  }
}

/** A request as the browser sends it, optionally with the cookies a response set. */
function request(cookies?: Headers) {
  const headers = new Headers()
  const cookie = cookies
    ?.getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  if (cookie) headers.set('cookie', cookie)
  return new Request('http://localhost:5173/', { headers })
}

describe('guests', { skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set' }, () => {
  const backend = () =>
    createBackend({ databaseUrl: appUrl(), baseURL: 'http://localhost:5173', secret: SECRET })
  const client = { clientAddress: '203.0.113.7' }

  before(async () => {
    const su = SUPERUSER_URL as string
    await query(su, `DROP DATABASE IF EXISTS ${appDatabaseName(APP)} WITH (FORCE)`)
    await query(su, `DROP ROLE IF EXISTS ${appDatabaseName(APP)}`)
    await query(su, `DROP ROLE IF EXISTS ${ADMIN}`)
    await query(su, `CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
    await provision(adminUrl(), { name: APP, password: APP_PASSWORD })
    await query(
      appUrl(),
      `CREATE TABLE public.notes (
      id serial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      body text NOT NULL
    )`,
    )
  })
  after(async () => {
    if (!SUPERUSER_URL) return
    await purge(adminUrl(), APP)
    await query(SUPERUSER_URL, `DROP ROLE IF EXISTS ${ADMIN}`)
  })

  it('creates a guest with an httpOnly session cookie on the first request', async () => {
    const kit = backend()
    try {
      const { guest, headers } = await kit.guest(request(), client)
      assert.match(guest.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      const cookie = headers.getSetCookie().find((c) => c.includes('session_token='))
      assert.ok(cookie, 'a session cookie is set')
      assert.match(cookie, /HttpOnly/i)
      assert.match(cookie, /SameSite=Lax/i)
      assert.match(cookie, /Path=\//i)
      assert.doesNotMatch(cookie, /Secure/i, 'not Secure on http://localhost')

      const row = await query(
        appUrl(),
        'SELECT is_anonymous, email, name FROM auth.users WHERE id = $1',
        [guest.id],
      )
      assert.equal(row.rows[0].is_anonymous, true)
      assert.match(row.rows[0].email, /@anonymous\.placeholder\.invalid$/)
    } finally {
      await kit.close()
    }
  })

  it('recognises the guest on the next request, even after a restart', async () => {
    let kit = backend()
    const first = await kit.guest(request(), client)
    const again = await kit.guest(request(first.headers), client)
    assert.equal(again.guest.id, first.guest.id)
    await query(appUrl(), `INSERT INTO public.notes (user_id, body) VALUES ($1, 'mine')`, [
      first.guest.id,
    ])
    await kit.close()

    kit = backend() // the app restarted (or was redeployed)
    try {
      const later = await kit.guest(request(first.headers), client)
      assert.equal(later.guest.id, first.guest.id)
      const notes = await query(appUrl(), 'SELECT body FROM public.notes WHERE user_id = $1', [
        later.guest.id,
      ])
      assert.deepEqual(notes.rows, [{ body: 'mine' }])
      const users = await query(
        appUrl(),
        'SELECT count(*)::int AS n FROM auth.users WHERE id = $1',
        [first.guest.id],
      )
      assert.equal(users.rows[0].n, 1, 'no duplicate guest')
    } finally {
      await kit.close()
    }
  })

  it('uses Secure cookies for an https app', async () => {
    const kit = createBackend({
      databaseUrl: appUrl(),
      baseURL: 'https://tagtape.app',
      secret: SECRET,
    })
    try {
      const { headers } = await kit.guest(new Request('https://tagtape.app/'), client)
      const cookie = headers.getSetCookie().find((c) => c.includes('session_token='))
      assert.match(cookie ?? '', /Secure/)
      assert.match(cookie ?? '', /HttpOnly/i)
    } finally {
      await kit.close()
    }
  })

  it('limits new guests per client address', async () => {
    const kit = createBackend({
      databaseUrl: appUrl(),
      baseURL: 'http://localhost:5173',
      secret: SECRET,
      guestLimit: { max: 2, windowMs: 60_000 },
    })
    try {
      const from = { clientAddress: '198.51.100.1' }
      const first = await kit.guest(request(), from)
      await kit.guest(request(), from)
      await assert.rejects(kit.guest(request(), from), (error: unknown) => {
        assert.ok(error instanceof GuestLimitError)
        assert.equal(error.status, 429)
        assert.ok(error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 60)
        return true
      })
      // Returning guests aren't limited, and other addresses aren't affected.
      await kit.guest(request(first.headers), from)
      await kit.guest(request(), { clientAddress: '198.51.100.2' })
    } finally {
      await kit.close()
    }
  })

  it('refuses to run against an older auth schema', async () => {
    await query(
      urlFor(ADMIN, ADMIN_PASSWORD, appDatabaseName(APP)),
      'DELETE FROM auth.kit_migrations',
    )
    const kit = backend()
    try {
      await assert.rejects(
        kit.guest(request(), client),
        /auth schema is at version 0.*Upgrade Spotcraft/s,
      )
    } finally {
      await kit.close()
      await provision(adminUrl(), { name: APP, password: APP_PASSWORD }).catch(() => {})
    }
  })
})

describe('kit settings and packaging', () => {
  it('checks the environment and names what is wrong', () => {
    const good = {
      DATABASE_URL: 'postgres://app_x:pw@postgres:5432/app_x',
      AUTH_SECRET: SECRET,
      PUBLIC_URL: 'https://tagtape.app',
    }
    assert.throws(() => backendFromEnv({ ...good, DATABASE_URL: undefined }), /DATABASE_URL/)
    assert.throws(() => backendFromEnv({ ...good, AUTH_SECRET: 'short' }), /AUTH_SECRET/)
    assert.throws(() => backendFromEnv({ ...good, PUBLIC_URL: 'http://tagtape.app' }), /PUBLIC_URL/)
    assert.throws(() => backendFromEnv({ ...good, PUBLIC_URL: 'tagtape.app' }), /PUBLIC_URL/)
    const kit = backendFromEnv({ ...good, PUBLIC_URL: 'http://localhost:5173' })
    return kit.close()
  })

  it('refuses to load in a browser bundle', async () => {
    const node = (conditions: string) =>
      promisify(execFile)(process.execPath, [
        `--conditions=${conditions}`,
        '--input-type=module',
        '-e',
        "import('@spotcraft/kit').then((m) => console.log(Object.keys(m).join(',')))",
      ])
    const server = await node('source')
    assert.match(server.stdout, /createBackend/)
    await assert.rejects(node('browser'), /server-only/)
  })
})
