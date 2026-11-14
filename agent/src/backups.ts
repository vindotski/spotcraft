import { spawn } from 'node:child_process'

/*
 * Nightly backups of every app to an S3-compatible bucket (ADR 0030): its settings
 * (`app.json`, `secrets.json`) and, for an app with a database, a `pg_dump` of it.
 */

/** Where the last backup of an app stands, kept as `apps/<name>/backup.json`. */
export interface BackupStatus {
  /** When the last attempt finished (ISO). */
  at: string
  ok: boolean
  /** The backup's folder in the bucket, `<name>/<time>/`, when it worked. */
  key?: string
  /** Size of the database dump; 0 for an app without a database. */
  bytes?: number
  /** Why it failed. */
  error?: string
  /** When a backup last worked, failed attempts since included. */
  lastOkAt?: string
}

/** Puts one object into the bucket. */
export interface BackupTarget {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>
}

/** Dumps one app's database, in pg_dump's custom format. */
export type Dump = (app: string) => Promise<Buffer>

/**
 * A dump larger than this fails. It is held in memory, twice at the end (the chunks and the
 * joined buffer), and the agent has 256 MB.
 */
export const MAX_DUMP_BYTES = 32 * 1024 * 1024

/** How long one dump may take, inside the container too (`timeout`), so it never lingers. */
const DUMP_SECONDS = 300

/**
 * `pg_dump` inside the Postgres container, as the superuser over its local socket (peer auth,
 * `infra/server/pg_hba.conf`): the agent's own role doesn't own the apps' tables. It gives up
 * on a table lock after 30 s rather than wait behind a migration, and on the whole dump after
 * DUMP_SECONDS, killed inside the container as well as here.
 */
export function dockerDump(
  postgresContainer: string,
  /** The app's database (the kit's `appDatabaseName`), passed in so this module needs no kit. */
  databaseName: (app: string) => string,
  timeoutMs = (DUMP_SECONDS + 15) * 1000,
): Dump {
  return (app) => {
    const database = databaseName(app)
    return new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          postgresContainer,
          'timeout',
          String(DUMP_SECONDS),
          'pg_dump',
          '-U',
          'postgres',
          '--format=custom',
          '--lock-wait-timeout=30s',
          database,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ''
      let failure: Error | undefined
      const timer = setTimeout(() => {
        failure = new Error(`pg_dump of ${database} took longer than ${timeoutMs / 1000} s`)
        child.kill()
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_DUMP_BYTES) {
          failure ??= new Error(
            `The dump of ${database} is larger than ${MAX_DUMP_BYTES / 1024 / 1024} MB, which the agent holds in memory`,
          )
          child.kill()
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (failure) reject(failure)
        else if (code !== 0) reject(new Error(`pg_dump of ${database} failed: ${stderr.trim()}`))
        else resolve(Buffer.concat(chunks))
      })
    })
  }
}

/** `20261114T030000Z`: sorts by time, and needs no encoding in a key. */
export const backupStamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')

/** Milliseconds until the next `hour`:00 UTC after `now`. */
export function untilNext(hour: number, now = new Date()): number {
  const next = new Date(now)
  next.setUTCHours(hour, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}
