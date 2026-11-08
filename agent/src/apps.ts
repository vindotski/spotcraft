import { randomBytes } from 'node:crypto'
import type { AppSpec } from './app-spec.ts'
import type { Runner, RunResult } from './runner.ts'
import type { Store } from './store.ts'
import { projectName, renderCompose, renderSite } from './templates.ts'

export class AgentError extends Error {
  readonly statusCode: number
  readonly output: string
  constructor(message: string, statusCode: number, output = '') {
    super(message)
    this.statusCode = statusCode
    this.output = output
  }
}

export interface AppStatus extends AppSpec {
  /** Container state from Docker: running, exited, restarting… or "missing". */
  state: string
  /** healthy, unhealthy, starting, or "" when the image has no healthcheck. */
  health: string
  /** Docker's human-readable status, e.g. "Up 3 hours (healthy)". */
  status: string
}

/** The fields of `docker ps --format json` the agent reads. */
interface ContainerRow {
  Labels?: string
  State?: string
  Status?: string
}

function withStatus(spec: AppSpec, row: ContainerRow | undefined): AppStatus {
  const status = row?.Status ?? ''
  // `docker ps` has no health field; Docker writes it into the status text.
  const health = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]
  return {
    ...spec,
    state: row?.State ?? 'missing',
    health: health === 'health: starting' ? 'starting' : (health ?? ''),
    status,
  }
}

/**
 * App databases on the apps server's Postgres (ADR 0015). Kept behind this interface so
 * this module (which the dashboard imports for its types) doesn't load the database code.
 */
export interface Databases {
  /** Creates or updates the app's role and database; returns the app's DATABASE_URL. */
  provision(name: string, password: string): Promise<string>
  /** Drops the app's database and role, if they exist. */
  purge(name: string): Promise<void>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const tail = (result: RunResult) => `${result.stdout}\n${result.stderr}`.trim().slice(-4000)

/** Deploys and removes apps. One change at a time; reads run freely. */
export class Apps {
  readonly #store: Store
  readonly #run: Runner
  readonly #caddyContainer: string
  readonly #databases: Databases | undefined
  #queue: Promise<unknown> = Promise.resolve()

  /** Without `databases`, apps can't ask for a database (the server has no Postgres). */
  constructor(store: Store, run: Runner, caddyContainer: string, databases?: Databases) {
    this.#store = store
    this.#run = run
    this.#caddyContainer = caddyContainer
    this.#databases = databases
  }

  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task)
    this.#queue = next.catch(() => {})
    return next
  }

  #compose(name: string, args: string[], timeoutMs?: number) {
    return this.#run(
      'docker',
      ['compose', '-p', projectName(name), '-f', this.#store.composePath(name), ...args],
      timeoutMs,
    )
  }

  async #reloadCaddy() {
    return this.#run('docker', [
      'exec',
      this.#caddyContainer,
      'caddy',
      'reload',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ])
  }

  async list(): Promise<AppStatus[]> {
    const specs = await this.#store.list()
    if (specs.length === 0) return []
    const containers = await this.#containers()
    return specs.map((spec) => withStatus(spec, containers.get(projectName(spec.name))))
  }

  async get(name: string): Promise<AppStatus | undefined> {
    const spec = await this.#store.get(name)
    if (!spec) return undefined
    const containers = await this.#containers(projectName(name))
    return withStatus(spec, containers.get(projectName(name)))
  }

  /**
   * Every app container's state from a single `docker ps` (one process, however many apps),
   * keyed by Compose project. With `project`, only that app's container.
   */
  async #containers(project?: string): Promise<Map<string, ContainerRow>> {
    const filter = project
      ? `label=com.docker.compose.project=${project}`
      : 'label=com.docker.compose.project'
    const result = await this.#run('docker', [
      'ps',
      '--all',
      '--filter',
      filter,
      '--format',
      'json',
    ])
    const rows = new Map<string, ContainerRow>()
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const row = JSON.parse(line) as ContainerRow
      const name = /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(row.Labels ?? '')?.[1]
      if (name?.startsWith('spotcraft-app-')) rows.set(name, row)
    }
    return rows
  }

  /** Writes the app's files and rolls it out; on failure, puts the previous version back. */
  deploy(spec: AppSpec): Promise<AppStatus> {
    return this.#exclusive(async () => {
      // The database first: if it can't be prepared, nothing else has changed yet.
      const databaseUrl = spec.database ? await this.#provision(spec.name) : undefined
      const previous = await this.#store.read(spec.name)
      const next = {
        spec: `${JSON.stringify(spec, null, 2)}\n`,
        compose: renderCompose(spec, databaseUrl),
        site: renderSite(spec),
      }
      await this.#store.write(spec.name, next)

      const pull = await this.#compose(spec.name, ['pull', '--quiet'])
      if (pull.code !== 0) {
        await this.#restore(spec.name, previous)
        throw new AgentError(`Could not pull ${spec.image}:${spec.tag}`, 502, tail(pull))
      }
      const up = await this.#compose(spec.name, ['up', '-d', '--wait', '--wait-timeout', '120'])
      if (up.code !== 0) {
        const logs = await this.#compose(spec.name, ['logs', '--tail', '50', '--no-color'])
        await this.#restore(spec.name, previous)
        throw new AgentError(
          `${spec.name} did not start or become healthy`,
          502,
          `${tail(up)}\n${tail(logs)}`,
        )
      }
      const reload = await this.#reloadCaddy()
      if (reload.code !== 0) {
        await this.#restore(spec.name, previous)
        throw new AgentError('Caddy rejected the site configuration', 500, tail(reload))
      }
      return withStatus(
        spec,
        (await this.#containers(projectName(spec.name))).get(projectName(spec.name)),
      )
    })
  }

  /** Prepares the app's database with its stored password (generated the first time). */
  async #provision(name: string): Promise<string> {
    if (!this.#databases) {
      throw new AgentError('This server has no Postgres configured for app databases', 409)
    }
    const secrets = await this.#store.readSecrets(name)
    const password = secrets.databasePassword ?? randomBytes(24).toString('hex')
    let url: string
    try {
      url = await this.#databases.provision(name, password)
    } catch (error) {
      throw new AgentError(`Could not prepare the database for ${name}`, 502, message(error))
    }
    if (!secrets.databasePassword) {
      await this.#store.writeSecrets(name, { ...secrets, databasePassword: password })
    }
    return url
  }

  /**
   * Brings every app database up to date (role settings, grants, `auth` migrations), e.g.
   * after Spotcraft was upgraded. Each app is tried even if another fails.
   */
  upgradeDatabases(): Promise<{ upgraded: string[]; failed: { name: string; error: string }[] }> {
    return this.#exclusive(async () => {
      const result = { upgraded: [] as string[], failed: [] as { name: string; error: string }[] }
      if (!this.#databases) return result
      for (const spec of await this.#store.list()) {
        if (!spec.database) continue
        try {
          await this.#provision(spec.name)
          result.upgraded.push(spec.name)
        } catch (error) {
          const detail = error instanceof AgentError ? error.output : message(error)
          result.failed.push({ name: spec.name, error: detail })
        }
      }
      return result
    })
  }

  async #restore(name: string, previous: Awaited<ReturnType<Store['read']>>) {
    if (previous) {
      await this.#store.write(name, previous)
      await this.#compose(name, ['up', '-d'])
    } else {
      await this.#compose(name, ['down', '--remove-orphans'])
      await this.#store.remove(name)
    }
    await this.#reloadCaddy()
  }

  /**
   * Stops and removes the app. Its database is kept unless `purge` is set, so removing an
   * app by mistake loses no data; with `purge`, the database and its role are dropped.
   */
  remove(name: string, { purge = false } = {}): Promise<boolean> {
    return this.#exclusive(async () => {
      if (!(await this.#store.read(name))) return false
      const down = await this.#compose(name, ['down', '--remove-orphans'])
      if (down.code !== 0) throw new AgentError(`Could not stop ${name}`, 500, tail(down))
      await this.#store.remove(name)
      await this.#reloadCaddy()
      if (purge && this.#databases) {
        try {
          await this.#databases.purge(name)
        } catch (error) {
          throw new AgentError(
            `${name} was removed, but its database could not be deleted`,
            500,
            message(error),
          )
        }
      }
      return true
    })
  }

  async logs(name: string, lines: number): Promise<string | undefined> {
    if (!(await this.#store.read(name))) return undefined
    const result = await this.#compose(name, [
      'logs',
      '--tail',
      String(lines),
      '--no-color',
      '--timestamps',
    ])
    return `${result.stdout}${result.stderr}`
  }
}
