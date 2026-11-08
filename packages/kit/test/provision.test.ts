// Runs against a real Postgres. KIT_TEST_POSTGRES_URL is a superuser URL for a throwaway
// server (CI starts one); without it these tests are skipped locally and fail in CI.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { appDatabaseName, authSchemaVersion, migrate, provision, purge } from '../src/provision.ts'
import {
  AUTH_SCHEMA_VERSION,
  accounts,
  migrations,
  sessions,
  users,
  verifications,
} from '../src/schema.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const ADMIN = 'kit_test_admin'
const ADMIN_PASSWORD = 'admin-password-0123456789'
const APPS = ['kit-a', 'kit-b']
const pw = (name: string, n = 1) => `${name}-password-${n}-0123456789`

/** The URL of the same server with another user and database. */
function urlFor(user: string, password: string, database = 'postgres') {
  const url = new URL(SUPERUSER_URL as string)
  url.username = user
  url.password = password
  url.pathname = `/${database}`
  return url.toString()
}
const adminUrl = () => urlFor(ADMIN, ADMIN_PASSWORD)
const appUrl = (name: string, password = pw(name), database = appDatabaseName(name)) =>
  urlFor(appDatabaseName(name), password, database)

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

/** The error message a statement fails with, or undefined if it succeeds. */
async function failure(url: string, sql: string): Promise<string | undefined> {
  try {
    await query(url, sql)
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

describe('kit provisioning', { skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set' }, () => {
  before(async () => {
    const su = SUPERUSER_URL as string
    for (const name of APPS)
      await query(su, `DROP DATABASE IF EXISTS ${appDatabaseName(name)} WITH (FORCE)`)
    for (const name of APPS) await query(su, `DROP ROLE IF EXISTS ${appDatabaseName(name)}`)
    await query(su, 'DROP DATABASE IF EXISTS kit_standalone WITH (FORCE)')
    await query(su, `DROP ROLE IF EXISTS kit_standalone`)
    await query(su, `DROP ROLE IF EXISTS ${ADMIN}`)
    // Like the server's spotcraft_agent, but without its createrole_self_grant setting:
    // provision must not depend on it.
    await query(su, `CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
  })

  after(async () => {
    if (!SUPERUSER_URL) return
    for (const name of APPS) await purge(adminUrl(), name)
    await query(SUPERUSER_URL, 'DROP DATABASE IF EXISTS kit_standalone WITH (FORCE)')
    await query(SUPERUSER_URL, 'DROP ROLE IF EXISTS kit_standalone')
    await query(SUPERUSER_URL, `DROP ROLE IF EXISTS ${ADMIN}`)
  })

  it('provisions an app, and running it again changes nothing', async () => {
    for (const name of APPS) await provision(adminUrl(), { name, password: pw(name) })
    await provision(adminUrl(), { name: 'kit-a', password: pw('kit-a') })

    const client = new pg.Client({ connectionString: appUrl('kit-a') })
    await client.connect()
    try {
      assert.equal(await authSchemaVersion(client), AUTH_SCHEMA_VERSION)
      const applied = await client.query(
        'SELECT version, name FROM auth.kit_migrations ORDER BY version',
      )
      assert.deepEqual(
        applied.rows,
        migrations.map(({ version, name }) => ({ version, name })),
      )
    } finally {
      await client.end()
    }
  })

  it('lets an app into its own database only', async () => {
    const own = await query<{ db: string }>(appUrl('kit-a'), 'SELECT current_database() AS db')
    assert.equal(own.rows[0].db, 'app_kit_a')
    assert.match(
      (await failure(appUrl('kit-a', pw('kit-a'), 'app_kit_b'), 'SELECT 1')) ?? '',
      /permission denied for database/,
    )
    assert.match(
      (await failure(appUrl('kit-b', pw('kit-b'), 'app_kit_a'), 'SELECT 1')) ?? '',
      /permission denied for database/,
    )
  })

  it('gives the app role no special attributes and the admin no inherited rights', async () => {
    const role = await query<{
      rolsuper: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolconnlimit: number
    }>(
      urlFor(ADMIN, ADMIN_PASSWORD),
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolconnlimit FROM pg_roles WHERE rolname = 'app_kit_a'`,
    )
    assert.deepEqual(role.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolconnlimit: 20,
    })
    const membership = await query<{ inherits: boolean; sets: boolean }>(
      adminUrl(),
      `SELECT pg_has_role('${ADMIN}', 'app_kit_a', 'USAGE') AS inherits, pg_has_role('${ADMIN}', 'app_kit_a', 'SET') AS sets`,
    )
    assert.deepEqual(membership.rows[0], { inherits: false, sets: true })
    const timeout = await query<{ statement_timeout: string }>(
      appUrl('kit-a'),
      'SHOW statement_timeout',
    )
    assert.equal(timeout.rows[0].statement_timeout, '30s')
  })

  it('lets the app use the auth tables but not change them', async () => {
    const url = appUrl('kit-a')
    const user = await query<{ id: string }>(
      url,
      `INSERT INTO auth.users (email, is_anonymous) VALUES ('guest-1@example.test', true) RETURNING id`,
    )
    assert.match(user.rows[0].id, /^[0-9a-f-]{36}$/)
    await query(
      url,
      `INSERT INTO auth.sessions (user_id, token, expires_at) VALUES ($1, 'token-1', now() + interval '1 day')`,
      [user.rows[0].id],
    )
    await query(url, `UPDATE auth.users SET name = 'Guest' WHERE id = $1`, [user.rows[0].id])
    await query(url, 'SELECT version FROM auth.kit_migrations')

    assert.match(
      (await failure(url, 'CREATE TABLE auth.extra (id int)')) ?? '',
      /permission denied for schema auth/,
    )
    assert.match(
      (await failure(url, 'ALTER TABLE auth.users ADD COLUMN extra int')) ?? '',
      /must be owner/,
    )
    assert.match((await failure(url, 'DROP TABLE auth.sessions')) ?? '', /must be owner/)
    assert.match((await failure(url, 'DROP SCHEMA auth CASCADE')) ?? '', /must be owner/)
    assert.match(
      (await failure(url, `INSERT INTO auth.kit_migrations (version, name) VALUES (99, 'x')`)) ??
        '',
      /permission denied/,
    )
    assert.match((await failure(url, 'DELETE FROM auth.kit_migrations')) ?? '', /permission denied/)
  })

  it("cascades the admin's user deletes into the app's own tables", async () => {
    const url = appUrl('kit-a')
    await query(
      url,
      `CREATE TABLE public.notes (
      id serial PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
      body text NOT NULL
    )`,
    )
    const user = await query<{ id: string }>(
      url,
      `INSERT INTO auth.users (email, is_anonymous) VALUES ('guest-2@example.test', true) RETURNING id`,
    )
    await query(url, `INSERT INTO public.notes (user_id, body) VALUES ($1, 'hello')`, [
      user.rows[0].id,
    ])

    // The admin owns auth.users but has no rights on public.notes; the cascade still runs.
    await query(
      urlFor(ADMIN, ADMIN_PASSWORD, 'app_kit_a'),
      'DELETE FROM auth.users WHERE id = $1',
      [user.rows[0].id],
    )
    const left = await query(url, 'SELECT 1 FROM public.notes WHERE user_id = $1', [
      user.rows[0].id,
    ])
    assert.equal(left.rowCount, 0)
  })

  it("updates the app's password when it changes", async () => {
    await provision(adminUrl(), { name: 'kit-b', password: pw('kit-b', 2) })
    assert.match(
      (await failure(appUrl('kit-b', pw('kit-b', 1)), 'SELECT 1')) ?? '',
      /password authentication failed/,
    )
    assert.equal(await failure(appUrl('kit-b', pw('kit-b', 2)), 'SELECT 1'), undefined)
  })

  it('purges an app, and purging again does nothing', async () => {
    await purge(adminUrl(), 'kit-b')
    await purge(adminUrl(), 'kit-b')
    const left = await query(
      adminUrl(),
      `SELECT 1 FROM pg_database WHERE datname = 'app_kit_b' UNION ALL SELECT 1 FROM pg_roles WHERE rolname = 'app_kit_b'`,
    )
    assert.equal(left.rowCount, 0)
  })

  it('migrates any database as its owner, outside Spotcraft', async () => {
    const su = SUPERUSER_URL as string
    await query(su, `CREATE ROLE kit_standalone LOGIN PASSWORD 'standalone-0123456789'`)
    await query(su, 'CREATE DATABASE kit_standalone OWNER kit_standalone')
    const url = urlFor('kit_standalone', 'standalone-0123456789', 'kit_standalone')
    assert.deepEqual(await migrate(url), { from: 0, to: AUTH_SCHEMA_VERSION })
    assert.deepEqual(await migrate(url), { from: AUTH_SCHEMA_VERSION, to: AUTH_SCHEMA_VERSION })
    // Concurrent runs wait for each other instead of applying a migration twice.
    await query(url, 'DROP SCHEMA auth CASCADE')
    const results = await Promise.all([migrate(url), migrate(url), migrate(url)])
    assert.equal(results.filter((r) => r.from === 0).length, 1)
  })

  it('defines the same tables in Drizzle as in the SQL migrations', async () => {
    const columns = await query<{
      table_name: string
      column_name: string
      data_type: string
      is_nullable: string
    }>(
      urlFor(ADMIN, ADMIN_PASSWORD, 'app_kit_a'),
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name <> 'kit_migrations' ORDER BY table_name, column_name`,
    )
    const sqlTypes: Record<string, string> = {
      uuid: 'uuid',
      text: 'text',
      boolean: 'boolean',
      'timestamp with time zone': 'timestamp with time zone',
    }
    const fromDrizzle = [users, sessions, accounts, verifications]
      .flatMap((table: PgTable) => {
        const config = getTableConfig(table)
        return config.columns.map((c) => ({
          table_name: config.name,
          column_name: c.name,
          data_type: sqlTypes[c.getSQLType()] ?? c.getSQLType(),
          is_nullable: c.notNull ? 'NO' : 'YES',
        }))
      })
      .sort((a, b) =>
        `${a.table_name}.${a.column_name}`.localeCompare(`${b.table_name}.${b.column_name}`),
      )
    assert.deepEqual(columns.rows, fromDrizzle)
  })

  it('refuses names that are not app names', () => {
    assert.equal(appDatabaseName('blog-api'), 'app_blog_api')
    for (const bad of [
      'Blog',
      'blog_api',
      '-blog',
      'a',
      `x${'y'.repeat(32)}`,
      'a"; drop role x; --',
    ]) {
      assert.throws(() => appDatabaseName(bad), /Not a valid app name/)
    }
  })
})
