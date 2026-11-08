import pg from 'pg'
import { AUTH_SCHEMA_VERSION, migrations } from './schema.ts'

const { Client, escapeIdentifier: id, escapeLiteral: lit } = pg

/** Spotcraft app names (the agent's NAME pattern); they become role and database names. */
const APP_NAME = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/

/** The role and database of an app: `blog-api` → `app_blog_api` (names never contain `_`). */
export function appDatabaseName(name: string): string {
  if (!APP_NAME.test(name)) throw new Error(`Not a valid app name: ${name}`)
  return `app_${name.replaceAll('-', '_')}`
}

/** Limits per app role, so one app can't starve the others on the shared server. */
const CONNECTION_LIMIT = 20
const STATEMENT_TIMEOUT = '30s'
const IDLE_IN_TRANSACTION_TIMEOUT = '60s'

// Any constant works; it only has to be the same for every process migrating `auth`.
const MIGRATION_LOCK = 4_250_816_001

async function connect(url: string, database?: string): Promise<pg.Client> {
  const target = new URL(url)
  if (database) target.pathname = `/${database}`
  const client = new Client({ connectionString: target.toString() })
  await client.connect()
  return client
}

/** Runs `fn` with a client and always closes it. */
async function withClient<T>(
  url: string,
  database: string | undefined,
  fn: (c: pg.Client) => Promise<T>,
) {
  const client = await connect(url, database)
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** The `auth` schema version a database is at; 0 when it has none. */
export async function authSchemaVersion(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ found: boolean }>(
    `SELECT to_regclass('auth.kit_migrations') IS NOT NULL AS found`,
  )
  if (!rows[0]?.found) return 0
  const latest = await client.query<{ version: number }>(
    'SELECT coalesce(max(version), 0)::int AS version FROM auth.kit_migrations',
  )
  return latest.rows[0]?.version ?? 0
}

/**
 * Brings the `auth` schema of the database at `url` to the latest version, in one transaction,
 * under an advisory lock so concurrent runs wait for each other. The connecting role owns the
 * schema. Works on any Postgres; on Spotcraft, `provision` calls it as the agent.
 */
export async function migrate(url: string): Promise<{ from: number; to: number }> {
  return withClient(url, undefined, (client) => migrateWith(client))
}

async function migrateWith(client: pg.Client): Promise<{ from: number; to: number }> {
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK])
    await client.query('CREATE SCHEMA IF NOT EXISTS auth')
    await client.query(`CREATE TABLE IF NOT EXISTS auth.kit_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const from = await authSchemaVersion(client)
    if (from > AUTH_SCHEMA_VERSION) {
      throw new Error(
        `The auth schema is at version ${from}, newer than this kit's ${AUTH_SCHEMA_VERSION}`,
      )
    }
    for (const migration of migrations.slice(from)) {
      await client.query(migration.sql)
      await client.query('INSERT INTO auth.kit_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ])
    }
    await client.query('COMMIT')
    return { from, to: AUTH_SCHEMA_VERSION }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export interface ProvisionOptions {
  /** The app's name, e.g. `blog`; its role and database are `app_blog`. */
  name: string
  /** The password of the app's role; set again on every run. */
  password: string
}

/**
 * Creates (or brings up to date) an app's role and database and its `auth` schema, connected
 * as `adminUrl`: a role with CREATEDB and CREATEROLE, the agent's on the server. Running it
 * again changes nothing except the password, if it changed.
 *
 * - The app role owns its database and `public`. Only it and the admin may connect.
 * - The admin owns `auth`; the app role may read and write its rows, reference its tables
 *   (foreign keys to `auth.users`) and read the migration version, but not change it.
 */
export async function provision(adminUrl: string, { name, password }: ProvisionOptions) {
  const role = appDatabaseName(name)
  if (password.length < 16) throw new Error('The app password must have at least 16 characters')

  await withClient(adminUrl, undefined, async (admin) => {
    const me = (await admin.query<{ me: string }>('SELECT current_user AS me')).rows[0].me
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount
    // NOSUPERUSER only on CREATE: Postgres refuses it in ALTER from a non-superuser, even as
    // a no-op, and a role created without it can't gain it from the admin anyway.
    const attributes = `LOGIN NOCREATEDB NOCREATEROLE CONNECTION LIMIT ${CONNECTION_LIMIT} PASSWORD ${lit(password)}`
    await admin.query(
      exists
        ? `ALTER ROLE ${id(role)} ${attributes}`
        : `CREATE ROLE ${id(role)} NOSUPERUSER ${attributes}`,
    )
    await admin.query(`ALTER ROLE ${id(role)} SET statement_timeout = ${lit(STATEMENT_TIMEOUT)}`)
    await admin.query(
      `ALTER ROLE ${id(role)} SET idle_in_transaction_session_timeout = ${lit(IDLE_IN_TRANSACTION_TIMEOUT)}`,
    )
    // Postgres only lets a role give a database to an owner it may SET ROLE to. The admin
    // doesn't inherit the app's rights.
    await admin.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)

    const hasDatabase = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [role]))
      .rowCount
    if (!hasDatabase) await admin.query(`CREATE DATABASE ${id(role)} OWNER ${id(role)}`)

    // Only the owner can take back the default CONNECT for everyone; as the admin, the REVOKE
    // would silently do nothing. The owner then lets the admin in to manage `auth`.
    await admin.query(`SET ROLE ${id(role)}`)
    await admin.query(`REVOKE ALL ON DATABASE ${id(role)} FROM PUBLIC`)
    await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${id(role)} TO ${id(me)}`)
    await admin.query('RESET ROLE')
  })

  await withClient(adminUrl, role, async (db) => {
    await migrateWith(db)
    await db.query(`GRANT USAGE ON SCHEMA auth TO ${id(role)}`)
    await db.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON ALL TABLES IN SCHEMA auth TO ${id(role)}`,
    )
    // The version table is read-only for the app (the kit checks it at start).
    await db.query(`REVOKE ALL ON auth.kit_migrations FROM ${id(role)}`)
    await db.query(`GRANT SELECT ON auth.kit_migrations TO ${id(role)}`)
  })
}

/** Drops an app's database and role. Nothing happens if they don't exist. */
export async function purge(adminUrl: string, name: string) {
  const role = appDatabaseName(name)
  await withClient(adminUrl, undefined, async (admin) => {
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount
    if (!exists) return
    const me = (await admin.query<{ me: string }>('SELECT current_user AS me')).rows[0].me
    await admin.query(`GRANT ${id(role)} TO ${id(me)} WITH INHERIT FALSE, SET TRUE`)
    // As the owner, which may drop its database and end its own open connections.
    await admin.query(`SET ROLE ${id(role)}`)
    await admin.query(`DROP DATABASE IF EXISTS ${id(role)} WITH (FORCE)`)
    await admin.query('RESET ROLE')
    await admin.query(`DROP ROLE ${id(role)}`)
  })
}
