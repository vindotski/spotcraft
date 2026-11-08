// The real database code against a real Postgres (see packages/kit's tests): skipped
// without KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pg from 'pg'
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
})
