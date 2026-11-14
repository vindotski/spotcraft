// The app migration runner. The unit tests always run; the rest need a real Postgres (see
// provision.test.ts): skipped without KIT_TEST_POSTGRES_URL locally, required in CI.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { type Migration, migrateApp, migrationsFromFiles, pending } from '../src/migrate.ts'
import { appDatabaseName, provision, purge } from '../src/provision.ts'

const SUPERUSER_URL = process.env.KIT_TEST_POSTGRES_URL
if (!SUPERUSER_URL && process.env.CI) throw new Error('KIT_TEST_POSTGRES_URL is not set')

const list = (...versions: number[]): Migration[] =>
  versions.map((version) => ({ version, name: `m${version}`, sql: '' }))
const rows = (...versions: number[]) =>
  versions.map((version) => ({ version, name: `m${version}` }))

describe('migrationsFromFiles', () => {
  it('sorts SQL files by name, numbers them from 1 and leaves out the rest', () => {
    const migrations = migrationsFromFiles([
      { name: 'migrations:0001_collections.sql', sql: 'b' },
      { name: 'meta/_journal.json', sql: '{}' },
      { name: 'migrations/0000_init.sql', sql: 'a' },
      { name: '0002_microban.sql', sql: 'c' },
    ])
    assert.deepEqual(migrations, [
      { version: 1, name: '0000_init', sql: 'a' },
      { version: 2, name: '0001_collections', sql: 'b' },
      { version: 3, name: '0002_microban', sql: 'c' },
    ])
  })

  it('refuses a name that is not lower-case snake_case', () => {
    assert.throws(() => migrationsFromFiles([{ name: '0000-Init.sql', sql: '' }]), /snake_case/)
  })
})

describe('pending', () => {
  it('runs what the database has not had yet', () => {
    assert.deepEqual(
      pending(list(1, 2, 3), []).map((m) => m.version),
      [1, 2, 3],
    )
    assert.deepEqual(
      pending(list(1, 2, 3), rows(1)).map((m) => m.version),
      [2, 3],
    )
    assert.deepEqual(pending(list(1, 2, 3), rows(1, 2, 3)), [])
  })

  it('refuses a migration numbered below one the database already has', () => {
    assert.throws(
      () => pending(list(1, 2, 3), rows(1, 3)),
      /Migration 2 \(m2\) is numbered below 3, which the database already has/,
    )
  })

  it('refuses a migration that changed name (a file added in the middle)', () => {
    assert.throws(
      () => pending(list(1, 2), [{ version: 1, name: 'other' }]),
      /Migration 1 was applied as other, but is now m1/,
    )
  })

  it('refuses a database newer than the app', () => {
    assert.throws(() => pending(list(1), rows(1, 2)), /has app migration 2.*knows only 1/)
  })
})

describe('migrateApp', { skip: !SUPERUSER_URL && 'KIT_TEST_POSTGRES_URL is not set' }, () => {
  const ADMIN = 'kit_migrate_admin'
  const ADMIN_PASSWORD = 'migrate-admin-password-0123456789'
  const APP = 'kit-migrate'
  const APP_PASSWORD = 'kit-migrate-password-0123456789'
  const urlFor = (user: string, password: string, database: string) => {
    const url = new URL(SUPERUSER_URL as string)
    url.username = user
    url.password = password
    url.pathname = `/${database}`
    return url.toString()
  }
  const adminUrl = () => urlFor(ADMIN, ADMIN_PASSWORD, 'postgres')
  const appUrl = () => urlFor(appDatabaseName(APP), APP_PASSWORD, appDatabaseName(APP))

  const pools: pg.Pool[] = []
  /** Drizzle as the app's own role, as an app on Spotcraft connects. */
  const appDb = () => {
    const pool = new pg.Pool({ connectionString: appUrl() })
    pools.push(pool)
    return drizzle(pool)
  }
  const query = async (text: string) => {
    const pool = new pg.Pool({ connectionString: appUrl(), max: 1 })
    try {
      return (await pool.query(text)).rows
    } finally {
      await pool.end()
    }
  }

  const NOTES: Migration = {
    version: 1,
    name: 'notes',
    sql: `CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL);
--> statement-breakpoint
INSERT INTO notes (body) VALUES ('first');`,
  }
  const TAGS: Migration = { version: 2, name: 'tags', sql: 'ALTER TABLE notes ADD tag text' }

  before(async () => {
    const su = new pg.Client({ connectionString: SUPERUSER_URL })
    await su.connect()
    await su.query(`DROP ROLE IF EXISTS ${ADMIN}`)
    await su.query(`CREATE ROLE ${ADMIN} LOGIN CREATEDB CREATEROLE PASSWORD '${ADMIN_PASSWORD}'`)
    await su.end()
  })
  beforeEach(async () => {
    await purge(adminUrl(), APP)
    await provision(adminUrl(), { name: APP, password: APP_PASSWORD })
  })
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()))
  })
  after(async () => {
    if (!SUPERUSER_URL) return
    await purge(adminUrl(), APP)
    const su = new pg.Client({ connectionString: SUPERUSER_URL })
    await su.connect()
    await su.query(`DROP ROLE IF EXISTS ${ADMIN}`)
    await su.end()
  })

  it('applies new migrations once, as the app role, and records them', async () => {
    const db = appDb()
    assert.deepEqual(await migrateApp(db, [NOTES]), { applied: [1], adopted: [] })
    assert.deepEqual(await migrateApp(db, [NOTES, TAGS]), { applied: [2], adopted: [] })
    assert.deepEqual(await migrateApp(db, [NOTES, TAGS]), { applied: [], adopted: [] })
    assert.deepEqual(await query('SELECT body, tag FROM notes'), [{ body: 'first', tag: null }])
    assert.deepEqual(
      (await query('SELECT version, name FROM public.app_migrations ORDER BY version')).map(
        (r) => `${r.version} ${r.name}`,
      ),
      ['1 notes', '2 tags'],
    )
  })

  it('rolls back every migration of the run when one fails', async () => {
    const broken: Migration = { version: 2, name: 'broken', sql: 'ALTER TABLE nope ADD x int' }
    await assert.rejects(
      migrateApp(appDb(), [NOTES, broken]),
      /App migration 2 \(broken\) failed: relation "nope" does not exist/,
    )
    assert.deepEqual(await query(`SELECT to_regclass('public.notes') AS t`), [{ t: null }])
    assert.deepEqual(await query(`SELECT to_regclass('public.app_migrations') AS t`), [{ t: null }])
  })

  it('refuses a migration added out of order', async () => {
    const db = appDb()
    await migrateApp(db, [NOTES, TAGS])
    await query('DELETE FROM public.app_migrations WHERE version = 1')
    await assert.rejects(migrateApp(db, [NOTES, TAGS]), /Migration 1 \(notes\) is numbered below 2/)
  })

  it('makes a second run wait for the first', async () => {
    const slow: Migration = {
      version: 1,
      name: 'slow',
      sql: 'SELECT pg_sleep(0.5); CREATE TABLE slow (id int)',
    }
    const [first, second] = await Promise.all([
      migrateApp(appDb(), [slow]),
      migrateApp(appDb(), [slow]),
    ])
    assert.deepEqual(
      [first.applied, second.applied].sort((a, b) => b.length - a.length),
      [[1], []],
    )
  })

  it('gives up on a table lock after 5 s', { timeout: 15_000 }, async () => {
    const db = appDb()
    await migrateApp(db, [NOTES])
    const holder = new pg.Client({ connectionString: appUrl() })
    await holder.connect()
    try {
      await holder.query('BEGIN; LOCK TABLE notes IN ACCESS SHARE MODE')
      const started = Date.now()
      await assert.rejects(
        migrateApp(db, [NOTES, TAGS]),
        /App migration 2 \(tags\) failed: canceling statement due to lock timeout/,
      )
      assert.ok(Date.now() - started < 8000)
    } finally {
      await holder.end()
    }
  })

  describe('adopting Drizzle', () => {
    const FILES = [
      { name: '0000_init.sql', sql: NOTES.sql },
      { name: '0001_tags.sql', sql: TAGS.sql },
    ]
    /** Runs Drizzle's own migrator over the first `count` files, as the app did before. */
    async function withDrizzle(count: number) {
      const folder = await mkdtemp(join(tmpdir(), 'kit-drizzle-'))
      try {
        await mkdir(join(folder, 'meta'))
        const entries = FILES.slice(0, count).map((file, idx) => ({
          idx,
          version: '7',
          when: 1_794_000_000_000 + idx,
          tag: file.name.slice(0, -4),
          breakpoints: true,
        }))
        await writeFile(
          join(folder, 'meta', '_journal.json'),
          JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
        )
        for (const file of FILES.slice(0, count)) await writeFile(join(folder, file.name), file.sql)
        await drizzleMigrate(appDb(), { migrationsFolder: folder })
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    }

    it("takes over Drizzle's history, then runs only what is new", async () => {
      await withDrizzle(1)
      const migrations = migrationsFromFiles(FILES)
      assert.deepEqual(await migrateApp(appDb(), migrations, { adoptDrizzle: true }), {
        applied: [2],
        adopted: [1],
      })
      assert.deepEqual(await query('SELECT body, tag FROM notes'), [{ body: 'first', tag: null }])
      // Later runs find app_migrations filled and leave Drizzle's table alone.
      assert.deepEqual(await migrateApp(appDb(), migrations, { adoptDrizzle: true }), {
        applied: [],
        adopted: [],
      })
    })

    it('refuses a file that is not the one Drizzle applied', async () => {
      await withDrizzle(1)
      const changed = migrationsFromFiles([{ name: '0000_init.sql', sql: `${NOTES.sql}\n` }])
      await assert.rejects(
        migrateApp(appDb(), changed, { adoptDrizzle: true }),
        /Migration 1 \(0000_init\) is not the file Drizzle applied as number 1/,
      )
    })

    it('runs everything on a fresh database', async () => {
      assert.deepEqual(
        await migrateApp(appDb(), migrationsFromFiles(FILES), { adoptDrizzle: true }),
        { applied: [1, 2], adopted: [] },
      )
    })
  })
})
