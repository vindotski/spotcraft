import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/*
 * Migrations for an app's own tables, in its database's `public` schema (ADR 0031). The kit's
 * `auth` schema has its own migrations, which Spotcraft runs; these are the app's.
 */

export interface Migration {
  /** From 1 up, without gaps or repeats. */
  version: number
  /** Lower-case letters, digits and `_`, e.g. `presets` or `0001_collections`. */
  name: string
  sql: string
}

export interface MigrateOptions {
  /**
   * Takes over from Drizzle's migrator (`drizzle-orm/.../migrator`). When the database has no
   * app migrations yet but `drizzle.__drizzle_migrations` has N, the first N migrations count
   * as applied without running. Each must be the same file Drizzle applied (its SHA-256).
   */
  adoptDrizzle?: boolean
}

const NAME = /^[a-z0-9_]+$/

/** Any fixed number: the advisory lock that makes concurrent runs (two slots) wait. */
const MIGRATION_LOCK = 4_826_101

/** Checks a list: numbered 1, 2, 3… in order, with valid names. Returns it. */
export function checkMigrations(migrations: readonly Migration[]): readonly Migration[] {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered 1, 2, 3… in order: ${migration.version} (${migration.name}) is number ${index + 1}`,
      )
    }
    if (!NAME.test(migration.name)) {
      throw new Error(`Migration name not in lower-case snake_case: ${migration.name}`)
    }
  })
  return migrations
}

/**
 * Migrations from SQL files, such as the ones `drizzle-kit generate` writes
 * (`0000_init.sql`, `0001_collections.sql`). Files not ending in `.sql` are left out, so the
 * whole folder can be passed, `meta/` included. The rest are sorted by name and numbered from 1;
 * a file's name, without `.sql` and any folder, is the migration's name.
 *
 * Only add files at the end: the name each version had is kept, and a file put between two
 * applied ones stops the next start.
 */
export function migrationsFromFiles(files: readonly { name: string; sql: string }[]): Migration[] {
  const sqlFiles = files
    .map((file) => ({ name: file.name.split(/[/:\\]/).at(-1) ?? '', sql: file.sql }))
    .filter((file) => file.name.endsWith('.sql'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return checkMigrations(
    sqlFiles.map((file, index) => ({
      version: index + 1,
      name: file.name.slice(0, -'.sql'.length),
      sql: file.sql,
    })),
  ) as Migration[]
}

/**
 * The migrations a database still needs, given the ones it has. It stops with an error when:
 * - an applied version now has another name: a file was added or renamed in the middle;
 * - a migration numbered below the newest applied one is missing (added out of order, say on
 *   a branch that merged late), since running it after newer ones could do the wrong thing;
 * - the database has a version this list doesn't (an older image against a newer database).
 */
export function pending(
  all: readonly Migration[],
  applied: readonly { version: number; name: string }[],
): Migration[] {
  const byVersion = new Map(all.map((m) => [m.version, m]))
  for (const row of applied) {
    const known = byVersion.get(row.version)
    if (known && known.name !== row.name) {
      throw new Error(
        `Migration ${row.version} was applied as ${row.name}, but is now ${known.name}: add new migrations only at the end`,
      )
    }
  }
  const newest = Math.max(0, ...applied.map((row) => row.version))
  if (newest > all.length) {
    throw new Error(
      `The database has app migration ${newest}, but this version of the app knows only ${all.length}`,
    )
  }
  const done = new Set(applied.map((row) => row.version))
  const skipped = all.filter((m) => m.version < newest && !done.has(m.version))
  if (skipped.length > 0) {
    const names = skipped.map((m) => `${m.version} (${m.name})`).join(', ')
    throw new Error(
      `Migration ${names} is numbered below ${newest}, which the database already has: renumber it after ${newest}`,
    )
  }
  return all.filter((m) => m.version > newest)
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * Applies the migrations the app's database hasn't had yet, all in one transaction, and records
 * them in `public.app_migrations`. Concurrent runs wait for each other (an advisory lock), and a
 * migration waits at most 5 s for a table lock, then fails, rather than hold every request
 * behind it. Returns the versions it applied, and the ones it adopted from Drizzle.
 */
export async function migrateApp(
  db: NodePgDatabase,
  migrations: readonly Migration[],
  options: MigrateOptions = {},
): Promise<{ applied: number[]; adopted: number[] }> {
  checkMigrations(migrations)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`)
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS public.app_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    let { rows } = await tx.execute<{ version: number; name: string }>(
      sql`SELECT version, name FROM public.app_migrations ORDER BY version`,
    )

    const adopted: number[] = []
    if (options.adoptDrizzle && rows.length === 0) {
      for (const migration of await drizzleHistory(tx, migrations)) {
        await tx.execute(
          sql`INSERT INTO public.app_migrations (version, name) VALUES (${migration.version}, ${migration.name})`,
        )
        adopted.push(migration.version)
      }
      rows = adopted.map((version) => ({ version, name: migrations[version - 1].name }))
    }

    const applied: number[] = []
    for (const migration of pending(migrations, rows)) {
      await tx.execute(sql.raw(migration.sql)).catch((error: unknown) => {
        // Drizzle's error only says "Failed query"; Postgres's reason is its cause.
        const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error
        const message = reason instanceof Error ? reason.message : String(reason)
        throw new Error(
          `App migration ${migration.version} (${migration.name}) failed: ${message}`,
          {
            cause: error,
          },
        )
      })
      await tx.execute(
        sql`INSERT INTO public.app_migrations (version, name) VALUES (${migration.version}, ${migration.name})`,
      )
      applied.push(migration.version)
    }
    return { applied, adopted }
  })
}

/** The migrations Drizzle's migrator applied, checked against the files by their hash. */
async function drizzleHistory(
  tx: Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0],
  migrations: readonly Migration[],
): Promise<readonly Migration[]> {
  const found = await tx.execute<{ found: boolean }>(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS found`,
  )
  if (!found.rows[0]?.found) return []
  const { rows } = await tx.execute<{ hash: string }>(
    sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id`,
  )
  if (rows.length > migrations.length) {
    throw new Error(
      `Drizzle applied ${rows.length} migrations, but the app has only ${migrations.length}`,
    )
  }
  return rows.map((row, index) => {
    const migration = migrations[index]
    if (sha256(migration.sql) !== row.hash) {
      throw new Error(
        `Migration ${migration.version} (${migration.name}) is not the file Drizzle applied as number ${index + 1}`,
      )
    }
    return migration
  })
}
