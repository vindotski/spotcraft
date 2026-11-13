#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { appDatabaseName, authSchemaVersion, provision, purge } from '@spotcraft/kit/provision'
import { AUTH_SCHEMA_VERSION } from '@spotcraft/kit/schema'
import pg from 'pg'
import { appName, localEnv, writeMissing } from './project.ts'
import {
  adminUrl,
  appPassword,
  databaseUrl,
  down,
  isRunning,
  PORT,
  StackError,
  up,
} from './stack.ts'

const HELP = `Usage: spotcraft dev <command> [--name <app>]

Runs the same Postgres and app database setup as a Spotcraft server, on this machine.

Commands:
  start         start the local Postgres and set up this app's database
  stop          stop the local Postgres (the data stays)
  status        show whether it runs and this app's database
  env [--write] print DATABASE_URL and AUTH_SECRET; --write adds missing ones to .env
  reset [--yes] delete this app's database and start it empty
  migrate       bring this app's database up to date after upgrading

The app name comes from --name or package.json. Needs Docker.
`

const print = (line = '') => process.stdout.write(`${line}\n`)

async function ensureRunning() {
  if (!(await isRunning()))
    throw new StackError('The local Postgres is not running; run `spotcraft dev start`')
}

/** The auth schema version of the app's database, or undefined if it doesn't exist. */
async function appDatabaseVersion(name: string): Promise<number | undefined> {
  const admin = new pg.Client({ connectionString: adminUrl() })
  await admin.connect()
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      appDatabaseName(name),
    ])
    if (!found.rowCount) return undefined
  } finally {
    await admin.end()
  }
  const db = new pg.Client({ connectionString: databaseUrl(name) })
  await db.connect()
  try {
    return await authSchemaVersion(db)
  } finally {
    await db.end()
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      write: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const [group, command] = positionals
  if (values.help || group !== 'dev' || !command) {
    print(HELP)
    return values.help ? 0 : 1
  }
  const cwd = process.cwd()

  switch (command) {
    case 'start': {
      const name = await appName(cwd, values.name)
      await up()
      await provision(adminUrl(), { name, password: appPassword(name) })
      print(`Local Postgres on 127.0.0.1:${PORT}; database ${appDatabaseName(name)} is ready.`)
      print()
      for (const [key, value] of await localEnv(cwd, databaseUrl(name))) print(`${key}=${value}`)
      print()
      print('Add these to .env with: spotcraft dev env --write')
      return 0
    }
    case 'stop':
      await down()
      print('Local Postgres stopped; the data stays.')
      return 0
    case 'status': {
      const name = await appName(cwd, values.name)
      if (!(await isRunning())) {
        print('Local Postgres: stopped (spotcraft dev start)')
        return 0
      }
      // Running but never set up (e.g. started by hand) reads as "no database yet".
      const version = await appDatabaseVersion(name).catch(() => undefined)
      print(`Local Postgres: running on 127.0.0.1:${PORT}`)
      if (version === undefined) print(`${appDatabaseName(name)}: none yet (spotcraft dev start)`)
      else {
        const note = version < AUTH_SCHEMA_VERSION ? ' (spotcraft dev migrate)' : ''
        print(`${appDatabaseName(name)}: auth schema ${version} of ${AUTH_SCHEMA_VERSION}${note}`)
      }
      return 0
    }
    case 'env': {
      const name = await appName(cwd, values.name)
      const env = await localEnv(cwd, databaseUrl(name))
      if (!values.write) {
        for (const [key, value] of env) print(`${key}=${value}`)
        return 0
      }
      const { added, kept } = await writeMissing(cwd, env)
      if (added.length) print(`Added to .env: ${added.join(', ')}`)
      if (kept.length) print(`Already in .env, left as they are: ${kept.join(', ')}`)
      return 0
    }
    case 'reset': {
      const name = await appName(cwd, values.name)
      await ensureRunning()
      const db = appDatabaseName(name)
      if (
        !values.yes &&
        !(await confirm(`Delete every row in the local ${db} and start it empty?`))
      ) {
        print('Nothing changed.')
        return 1
      }
      await purge(adminUrl(), name)
      await provision(adminUrl(), { name, password: appPassword(name) })
      print(`${db} is empty again.`)
      return 0
    }
    case 'migrate': {
      const name = await appName(cwd, values.name)
      await ensureRunning()
      await provision(adminUrl(), { name, password: appPassword(name) })
      print(`${appDatabaseName(name)}: auth schema ${AUTH_SCHEMA_VERSION}.`)
      return 0
    }
    default:
      print(HELP)
      return 1
  }
}

// Run when executed (not when a test imports it).
if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`spotcraft: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    },
  )
}
