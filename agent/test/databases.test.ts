// The real database code against a real Postgres (see packages/kit's tests): skipped
// without KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
import { AgentError } from '../src/apps.ts'
import { postgresDatabases } from '../src/databases.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'agent_test_admin'
const ADMIN_PASSWORD = 'agent-admin-password-0123456789'

async function query(url: string, sql: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query(sql)
  } finally {
    await client.end()
  }
}

describe('postgres app databases', {
  skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set',
}, () => {
  const adminUrl = () => {
    const url = new URL(SUPERUSER_URL as string)
    url.username = ADMIN
    url.password = ADMIN_PASSWORD
    return url.toString()
  }

  before(async () => {
    const su = SUPERUSER_URL as string
    await query(su, 'DROP DATABASE IF EXISTS app_agent_test WITH (FORCE)')
    await query(su, 'DROP ROLE IF EXISTS app_agent_test')
    await query(su, `DROP ROLE IF EXISTS ${ADMIN}`)
    await query(su, `CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
  })
  after(async () => {
    if (!SUPERUSER_URL) return
    await postgresDatabases(adminUrl()).purge('agent-test')
    await query(SUPERUSER_URL, `DROP ROLE IF EXISTS ${ADMIN}`)
  })

  it('returns a DATABASE_URL the app can use, and purges', async () => {
    const databases = postgresDatabases(adminUrl())
    const url = await databases.provision('agent-test', 'app-password-0123456789')
    const parsed = new URL(url)
    assert.equal(parsed.username, 'app_agent_test')
    assert.equal(parsed.pathname, '/app_agent_test')
    assert.equal(parsed.host, new URL(SUPERUSER_URL as string).host)

    const { rows } = await query(url, 'SELECT current_database() AS db, current_user AS me')
    assert.deepEqual(rows[0], { db: 'app_agent_test', me: 'app_agent_test' })
    const users = await query(url, 'SELECT count(*)::int AS n FROM auth.users')
    assert.equal(users.rows[0].n, 0)

    await databases.purge('agent-test')
    const left = await query(
      SUPERUSER_URL as string,
      `SELECT datname AS name FROM pg_database WHERE datname = 'app_agent_test'
       UNION ALL SELECT rolname FROM pg_roles WHERE rolname = 'app_agent_test'`,
    )
    assert.equal(left.rowCount, 0)
    await assert.rejects(query(url, 'SELECT 1'), /password authentication failed/)
  })

  it("lists an app's users newest first, page by page, and deletes with cascades", async () => {
    const databases = postgresDatabases(adminUrl())
    const url = await databases.provision('agent-test', 'app-password-0123456789')
    // Three users a minute apart: a registered one and two guests, one with an old session.
    await query(
      url,
      `CREATE TABLE public.notes (
      id serial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      body text NOT NULL)`,
    )
    const { rows: made } = await query(
      url,
      `INSERT INTO auth.users (email, is_anonymous, created_at) VALUES
         ('member@example.test', false, now() - interval '3 minutes'),
         ('guest-1@example.test', true, now() - interval '2 minutes'),
         ('guest-2@example.test', true, now() - interval '1 minute')
       RETURNING id, email`,
    )
    const idOf = (email: string) => made.find((row) => row.email === email)?.id as string
    await query(
      url,
      `INSERT INTO auth.sessions (user_id, token, expires_at, updated_at) VALUES
         ('${idOf('guest-1@example.test')}', 't1', now() + interval '1 day', now() - interval '30 seconds'),
         ('${idOf('guest-1@example.test')}', 't2', now() + interval '1 day', now() - interval '90 seconds')`,
    )
    await query(
      url,
      `INSERT INTO public.notes (user_id, body) VALUES ('${idOf('guest-1@example.test')}', 'hi')`,
    )

    const first = await databases.listUsers('agent-test', { limit: 2 })
    assert.equal(first.available, true)
    assert.equal(first.total, 3)
    assert.deepEqual(
      first.users.map((u) => [u.id, u.guest]),
      [
        [idOf('guest-2@example.test'), true],
        [idOf('guest-1@example.test'), true],
      ],
    )
    assert.equal(first.users[0].lastSeen, null, 'no session')
    const seen = Date.parse(first.users[1].lastSeen ?? '')
    assert.ok(Date.now() - seen < 60_000, 'the most recent of their sessions')
    assert.ok(first.next)

    const second = await databases.listUsers('agent-test', { limit: 2, cursor: first.next })
    assert.deepEqual(
      second.users.map((u) => [u.id, u.guest]),
      [[idOf('member@example.test'), false]],
    )
    assert.equal(second.next, undefined)
    await assert.rejects(
      databases.listUsers('agent-test', { limit: 2, cursor: 'bm9wZQ' }),
      (error: unknown) => error instanceof AgentError && error.statusCode === 400,
    )

    assert.equal(await databases.deleteUser('agent-test', idOf('guest-1@example.test')), true)
    assert.equal(await databases.deleteUser('agent-test', idOf('guest-1@example.test')), false)
    const left = await query(
      url,
      `SELECT (SELECT count(*) FROM auth.sessions)::int AS sessions, (SELECT count(*) FROM public.notes)::int AS notes`,
    )
    assert.deepEqual(left.rows[0], { sessions: 0, notes: 0 })
    assert.equal((await databases.listUsers('agent-test', { limit: 10 })).total, 2)
    await databases.purge('agent-test')
  })
})
