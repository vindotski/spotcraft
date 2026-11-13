import { spawn } from 'node:child_process'
import { appDatabaseName } from '@spotcraft/kit/provision'

/**
 * The local stack: one Postgres for every app repository on this machine, set up like the
 * Spotcraft server's (ADR 0017). Tests keep the values below equal to the server's files.
 */
export const PROJECT = 'spotcraft-dev'
export const CONTAINER = `${PROJECT}-postgres-1`
export const PORT = 54340

/** The server's Postgres image (infra/server/compose.yaml). */
export const POSTGRES_IMAGE =
  'postgres:18.6-trixie@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42'

/** The server's Postgres login rules (infra/server/pg_hba.conf). */
export const PG_HBA = `# TYPE  DATABASE  USER      ADDRESS  METHOD
local   all       postgres           peer
local   all       all                reject
host    all       postgres  all      reject
host    all       all       all      scram-sha-256
`

/** The agent's role, exactly as the deploy script sets it up (infra/remote-deploy.sh). */
export const ADMIN_SQL = `SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotcraft_agent') AS missing \\gset
\\if :missing
  CREATE ROLE spotcraft_agent LOGIN CREATEDB CREATEROLE PASSWORD :'pw';
\\else
  ALTER ROLE spotcraft_agent LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD :'pw';
\\endif
-- Roles the agent creates (one per app) are ones it may SET ROLE to, which Postgres requires
-- to make them a database's owner; it doesn't inherit their rights.
ALTER ROLE spotcraft_agent SET createrole_self_grant = 'set';
-- Apps get CONNECT on their own database only; the built-in ones are the agent's.
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO spotcraft_agent;
`

// Fixed local passwords keep DATABASE_URL the same across runs (and in .env). Acceptable only
// because the port is bound to 127.0.0.1 and the data is throwaway.
const SUPERUSER_PASSWORD = 'spotcraft-dev-superuser'
const ADMIN_PASSWORD = 'spotcraft-dev-admin-password'
export const appPassword = (name: string) => `local-${name}-password`

export const adminUrl = () =>
  `postgres://spotcraft_agent:${ADMIN_PASSWORD}@127.0.0.1:${PORT}/postgres`

/** What the app gets, as on the server but on localhost. */
export function databaseUrl(name: string): string {
  const db = appDatabaseName(name)
  return `postgres://${db}:${appPassword(name)}@127.0.0.1:${PORT}/${db}`
}

/** The Compose file, as JSON (valid YAML), passed to Docker on stdin. */
export function composeFile(): string {
  return JSON.stringify({
    name: PROJECT,
    services: {
      postgres: {
        image: POSTGRES_IMAGE,
        restart: 'unless-stopped',
        environment: { POSTGRES_PASSWORD: SUPERUSER_PASSWORD },
        command: [
          'postgres',
          '-c',
          'hba_file=/etc/postgresql/pg_hba.conf',
          '-c',
          'password_encryption=scram-sha-256',
        ],
        configs: [{ source: 'pg_hba', target: '/etc/postgresql/pg_hba.conf' }],
        ports: [`127.0.0.1:${PORT}:5432`],
        volumes: ['data:/var/lib/postgresql'],
        healthcheck: {
          test: ['CMD', 'pg_isready', '-q', '-h', '/var/run/postgresql', '-U', 'postgres'],
          interval: '2s',
          timeout: '5s',
          retries: 30,
        },
      },
    },
    volumes: { data: {} },
    configs: { pg_hba: { content: PG_HBA } },
  })
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a command without a shell, optionally feeding `input` on stdin. */
export function run(file: string, args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(input ?? '')
  })
}

export type Runner = typeof run

export class StackError extends Error {}

/** Docker Compose for the local stack; the file comes on stdin. */
async function compose(runner: Runner, args: string[]): Promise<RunResult> {
  return runner('docker', ['compose', '-p', PROJECT, '-f', '-', ...args], composeFile())
}

function fail(what: string, result: RunResult): never {
  throw new StackError(`${what}\n${`${result.stderr}${result.stdout}`.trim()}`)
}

/** Starts Postgres (if needed), waits until it is healthy, and sets up the agent's role. */
export async function up(runner: Runner = run) {
  const docker = await runner('docker', ['version', '--format', '{{.Server.Version}}'])
  if (docker.code !== 0) fail('Docker is not running (the local stack needs it).', docker)
  const started = await compose(runner, ['up', '-d', '--wait', '--wait-timeout', '120'])
  if (started.code !== 0) fail('Could not start the local Postgres.', started)
  // As the OS user `postgres`: the superuser only logs in over the socket with `peer`.
  const role = await runner(
    'docker',
    [
      'exec',
      '-i',
      '-u',
      'postgres',
      CONTAINER,
      'psql',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    `\\set pw ${ADMIN_PASSWORD}\n${ADMIN_SQL}`,
  )
  if (role.code !== 0) fail("Could not set up the agent's role.", role)
}

/** Stops Postgres; the data stays in its volume. */
export async function down(runner: Runner = run) {
  const stopped = await compose(runner, ['stop'])
  if (stopped.code !== 0) fail('Could not stop the local Postgres.', stopped)
}

/** Whether the local Postgres container is running. */
export async function isRunning(runner: Runner = run): Promise<boolean> {
  const state = await runner('docker', ['inspect', '--format', '{{.State.Running}}', CONTAINER])
  return state.code === 0 && state.stdout.trim() === 'true'
}
