import { randomBytes } from 'node:crypto'
import type { AccessApps } from './access.ts'
import {
  type AgentSettings,
  type AppSpec,
  customHosts,
  type DomainStatus,
  defaultHost,
  hostnames,
  projectName,
  servedHosts,
} from './app-spec.ts'
import { CloudflareError } from './cloudflare.ts'
import { DomainConflict, type Domains } from './domains.ts'
import type { Runner, RunResult } from './runner.ts'
import type { AppFiles, Store } from './store.ts'
import { renderCompose, renderSite } from './templates.ts'

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
  /** Every host the app answers on, its default host first (ADR 0021). */
  hostnames: string[]
}

/** The fields of `docker ps --format json` the agent reads. */
interface ContainerRow {
  Labels?: string
  State?: string
  Status?: string
}

function withStatus(
  spec: AppSpec,
  row: ContainerRow | undefined,
  settings: AgentSettings,
): AppStatus {
  const status = row?.Status ?? ''
  // `docker ps` has no health field; Docker writes it into the status text.
  const health = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]
  return {
    ...spec,
    state: row?.State ?? 'missing',
    health: health === 'health: starting' ? 'starting' : (health ?? ''),
    status,
    hostnames: hostnames(spec, settings.appsDomain),
  }
}

/**
 * App databases on the server's Postgres (ADR 0015). Kept behind this interface so
 * this module (which the dashboard imports for its types) doesn't load the database code.
 */
export interface Databases {
  /** Creates or updates the app's role and database; returns the app's DATABASE_URL. */
  provision(name: string, password: string): Promise<string>
  /** Drops the app's database and role, if they exist. */
  purge(name: string): Promise<void>
  /** A page of the app's users (ADR 0018), newest first. */
  listUsers(name: string, page: { limit: number; cursor?: string }): Promise<UserPage>
  /** Deletes a user; their sessions and the app's rows go with them. False if not found. */
  deleteUser(name: string, id: string): Promise<boolean>
}

/** A user of an app, as the dashboard shows it. */
export interface AppUser {
  id: string
  /** A guest (no sign-up) rather than a registered user. */
  guest: boolean
  createdAt: string
  /** When a session of theirs was last used; null if they have none left. */
  lastSeen: string | null
}

export interface UserPage {
  /** False when the app's database has no `auth` schema (it doesn't use the kit). */
  available: boolean
  total: number
  users: AppUser[]
  /** Pass back as `cursor` for the next (older) page; absent on the last page. */
  next?: string
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const tail = (result: RunResult) => `${result.stdout}\n${result.stderr}`.trim().slice(-4000)

/** Deploys and removes apps. One change at a time; reads run freely. */
export class Apps {
  readonly #store: Store
  readonly #run: Runner
  readonly #caddyContainer: string
  readonly #databases: Databases | undefined
  readonly settings: AgentSettings
  readonly #domains: Domains | undefined
  readonly #access: AccessApps | undefined
  #queue: Promise<unknown> = Promise.resolve()

  /** Without `databases`, apps can't ask for a database (the server has no Postgres). */
  constructor(
    store: Store,
    run: Runner,
    caddyContainer: string,
    databases?: Databases,
    settings: AgentSettings = { edge: 'direct' },
    /**
     * With it, custom domains' DNS is set up through the Cloudflare API and, with `access`,
     * protected apps are put behind Cloudflare Access (ADR 0021).
     */
    cloudflare?: { domains: Domains; access?: AccessApps },
  ) {
    this.#store = store
    this.#run = run
    this.#caddyContainer = caddyContainer
    this.#databases = databases
    this.settings = {
      ...settings,
      dns: Boolean(cloudflare?.domains),
      access: Boolean(cloudflare?.access),
    }
    this.#domains = cloudflare?.domains
    this.#access = cloudflare?.access
  }

  /** Runs a Cloudflare step; its failures become clear agent errors. */
  async #cloudflare<T>(what: string, step: () => Promise<T>): Promise<T> {
    try {
      return await step()
    } catch (error) {
      if (error instanceof DomainConflict) throw new AgentError(error.message, 409)
      const detail = error instanceof CloudflareError ? error.message : message(error)
      throw new AgentError(`Could not ${what}`, 502, detail)
    }
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
    return specs.map((spec) =>
      withStatus(spec, containers.get(projectName(spec.name)), this.settings),
    )
  }

  async get(name: string): Promise<AppStatus | undefined> {
    const spec = await this.#store.get(name)
    if (!spec) return undefined
    const containers = await this.#containers(projectName(name))
    return withStatus(spec, containers.get(projectName(name)), this.settings)
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

  /**
   * Writes the app's files and rolls it out; on failure, puts the previous version back.
   * With `spec.takeOver`, a custom domain's existing DNS records are replaced (ADR 0022).
   */
  deploy(spec: AppSpec): Promise<AppStatus> {
    return this.#exclusive(async () => {
      const previousSpec = await this.#store.get(spec.name)
      const oldHosts = previousSpec ? customHosts(previousSpec) : []
      const newHosts = customHosts(spec)
      // DNS first, then the database: if either can't be prepared, the app hasn't changed yet.
      const domains = this.#domains
      const undoDns = domains
        ? await this.#cloudflare(`set up DNS for ${spec.domain}`, () =>
            domains.attach(spec.name, newHosts, { takeOver: Boolean(spec.takeOver) }),
          )
        : undefined
      const access = this.#access
      let status: AppStatus
      try {
        // Protection goes on before the new version takes traffic.
        if (access) {
          await this.#cloudflare('set up Cloudflare Access', () =>
            access.sync(
              spec.name,
              servedHosts(spec, this.settings.appsDomain),
              Boolean(spec.protected),
            ),
          )
        }
        status = await this.#rollOut(spec)
      } catch (error) {
        // Put DNS back exactly as it was (records a take-over replaced included), and the
        // previous protection (best effort).
        await undoDns?.()
        await access
          ?.sync(
            spec.name,
            previousSpec ? servedHosts(previousSpec, this.settings.appsDomain) : [],
            Boolean(previousSpec?.protected),
          )
          .catch(() => {})
        throw error
      }
      // A domain the app no longer has: its records go, now that the new version runs.
      const dropped = oldHosts.filter((host) => !newHosts.includes(host))
      await this.#domains?.detach(spec.name, dropped).catch((error) => {
        console.warn(`could not remove DNS records for ${dropped.join(', ')}: ${message(error)}`)
      })
      return status
    })
  }

  async #rollOut(spec: AppSpec): Promise<AppStatus> {
    const databaseUrl = spec.database ? await this.#provision(spec.name) : undefined
    const previous = await this.#store.read(spec.name)
    const next = {
      spec: `${JSON.stringify(spec, null, 2)}\n`,
      compose: renderCompose(spec, databaseUrl),
      site: renderSite(spec, this.settings),
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
      this.settings,
    )
  }

  /** Where the app's custom domain stands; undefined if there is no such app. */
  async domainStatus(name: string): Promise<DomainStatus | undefined> {
    const spec = await this.#store.get(name)
    if (!spec) return undefined
    const { appsDomain, edge } = this.settings
    const target = appsDomain ? defaultHost(name, appsDomain) : undefined
    const hosts = customHosts(spec)
    if (this.#domains && target) {
      return { target, hosts: await this.#domains.status(name, hosts, target) }
    }
    // Spotcraft doesn't manage DNS: say what to create by hand.
    return {
      target,
      hosts: hosts.map((host) => ({
        host,
        mode: 'manual',
        state: 'unknown',
        records: [
          target && edge === 'cloudflare'
            ? { type: 'CNAME', name: host, value: target }
            : { type: 'A/AAAA', name: host, value: 'the server' },
        ],
      })),
    }
  }

  /**
   * Rewrites every app's Caddy site for the current settings and reloads Caddy if any
   * changed. Sites depend on EDGE and APPS_DOMAIN, so after either changes (a redeploy of
   * Spotcraft), every app must follow, not only the next one deployed. Returns the apps whose
   * site changed.
   */
  refreshSites(): Promise<string[]> {
    return this.#exclusive(async () => {
      const pending: { spec: AppSpec; files: AppFiles; site: string }[] = []
      for (const spec of await this.#store.list()) {
        // Compose files carry DATABASE_URL; older ones were written readable by everyone.
        await this.#store.lockDownCompose(spec.name)
        const files = await this.#store.read(spec.name)
        const site = renderSite(spec, this.settings)
        if (files && files.site !== site) pending.push({ spec, files, site })
      }
      if (pending.length === 0) return []
      // Protected apps' new hosts go behind Access before Caddy serves them, next to the old
      // ones: whatever fails from here on (another app's Access update, Caddy's reload), every
      // host that might be served stays protected. It narrows to the new hosts at the end.
      const access = this.#access
      const protectedSpecs = pending.filter((p) => p.spec.protected).map((p) => p.spec)
      if (access) {
        for (const spec of protectedSpecs) {
          await this.#cloudflare(`protect ${spec.name} with Cloudflare Access`, () =>
            access.extend(spec.name, servedHosts(spec, this.settings.appsDomain)),
          )
        }
      }
      for (const { spec, files, site } of pending)
        await this.#store.write(spec.name, { ...files, site })
      const reload = await this.#reloadCaddy()
      if (reload.code !== 0) {
        // Put the previous sites back, so Caddy keeps a configuration it accepts; the next
        // attempt rewrites them again.
        for (const { spec, files } of pending) await this.#store.write(spec.name, files)
        await this.#reloadCaddy()
        throw new AgentError('Caddy rejected the rewritten sites', 500, tail(reload))
      }
      // The old hosts are gone from Caddy now; protection can drop them (extra hosts would be
      // harmless, so a failure here only leaves them listed).
      if (access) {
        for (const spec of protectedSpecs) {
          await access
            .sync(spec.name, servedHosts(spec, this.settings.appsDomain), true)
            .catch(() => {})
        }
      }
      return pending.map((p) => p.spec.name)
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

  /** The app's database interface, or why its users can't be shown (404 or 409). */
  async #userDatabase(name: string): Promise<Databases> {
    const spec = await this.#store.get(name)
    if (!spec) throw new AgentError('No such app', 404)
    if (!spec.database || !this.#databases) throw new AgentError(`${name} has no database`, 409)
    return this.#databases
  }

  async listUsers(name: string, page: { limit: number; cursor?: string }): Promise<UserPage> {
    return (await this.#userDatabase(name)).listUsers(name, page)
  }

  async deleteUser(name: string, id: string): Promise<boolean> {
    return (await this.#userDatabase(name)).deleteUser(name, id)
  }

  /**
   * Stops and removes the app. Its database is kept unless `purge` is set, so removing an
   * app by mistake loses no data; with `purge`, the database and its role are dropped.
   */
  remove(name: string, { purge = false } = {}): Promise<boolean> {
    return this.#exclusive(async () => {
      const spec = await this.#store.get(name)
      if (!spec) return false
      const down = await this.#compose(name, ['down', '--remove-orphans'])
      if (down.code !== 0) throw new AgentError(`Could not stop ${name}`, 500, tail(down))
      await this.#store.remove(name)
      await this.#reloadCaddy()
      try {
        await this.#domains?.detach(name, customHosts(spec))
        await this.#access?.sync(name, [], false)
      } catch (error) {
        throw new AgentError(
          `${name} was removed, but its DNS records or Access application could not be deleted`,
          500,
          message(error),
        )
      }
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
