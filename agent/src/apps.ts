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
  slotService,
} from './app-spec.ts'
import { CloudflareError } from './cloudflare.ts'
import { DomainConflict, type Domains } from './domains.ts'
import type { Runner, RunResult } from './runner.ts'
import type { AppFiles, Store } from './store.ts'
import { composeService, renderCompose, renderSite } from './templates.ts'

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
  ID?: string
  Labels?: string
  State?: string
  Status?: string
}

const label = (row: ContainerRow, key: string) =>
  new RegExp(`(?:^|,)${key.replaceAll('.', '\\.')}=([^,]+)`).exec(row.Labels ?? '')?.[1]

/** The live slot's container, out of an app's containers (both slots run during a deploy). */
const liveRow = (rows: ContainerRow[] | undefined, service: string | undefined) =>
  rows?.find((row) => label(row, 'com.docker.compose.service') === service) ?? rows?.[0]

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

  /** Runs Compose on the app's live compose file, or with `staged` on a deploy's new one. */
  #compose(name: string, args: string[], { staged = false } = {}) {
    const file = staged ? this.#store.stagedComposePath(name) : this.#store.composePath(name)
    return this.#run('docker', ['compose', '-p', projectName(name), '-f', file, ...args])
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
    return Promise.all(
      specs.map(async (spec) =>
        withStatus(
          spec,
          liveRow(containers.get(projectName(spec.name)), await this.#liveService(spec.name)),
          this.settings,
        ),
      ),
    )
  }

  async get(name: string): Promise<AppStatus | undefined> {
    const spec = await this.#store.get(name)
    if (!spec) return undefined
    return this.#status(spec)
  }

  async #status(spec: AppSpec): Promise<AppStatus> {
    const project = projectName(spec.name)
    const rows = (await this.#containers(project)).get(project)
    return withStatus(spec, liveRow(rows, await this.#liveService(spec.name)), this.settings)
  }

  /** The service of the app's live slot, from its compose file; undefined if it has none. */
  async #liveService(name: string): Promise<string | undefined> {
    const files = await this.#store.read(name)
    return files ? composeService(files.compose) : undefined
  }

  /**
   * Every app container's state from a single `docker ps` (one process, however many apps),
   * grouped by Compose project. With `project`, only that app's containers.
   */
  async #containers(project?: string): Promise<Map<string, ContainerRow[]>> {
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
    const rows = new Map<string, ContainerRow[]>()
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const row = JSON.parse(line) as ContainerRow
      const name = label(row, 'com.docker.compose.project')
      if (name?.startsWith('spotcraft-app-')) rows.set(name, [...(rows.get(name) ?? []), row])
    }
    return rows
  }

  /** Stops and removes the app's containers other than `keep`'s: the slot traffic left. */
  async #removeOtherSlots(name: string, keep: string | undefined) {
    const rows = (await this.#containers(projectName(name))).get(projectName(name)) ?? []
    const ids = rows
      .filter((row) => label(row, 'com.docker.compose.service') !== keep)
      .map((row) => row.ID)
      .filter((id): id is string => Boolean(id))
    if (ids.length === 0) return
    // SIGTERM, then up to 30 seconds to finish the requests it already has (as its compose
    // file's stop_grace_period). A failure leaves it running, which costs memory, not traffic.
    const stop = await this.#run('docker', ['stop', '--time', '30', ...ids], 60_000)
    const rm = stop.code === 0 ? await this.#run('docker', ['rm', ...ids]) : stop
    if (rm.code !== 0) console.warn(`could not remove the old slot of ${name}: ${tail(rm)}`)
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

  /**
   * Starts the new version in the slot that isn't live, next to the live one; once it is
   * healthy, Caddy moves traffic to it and the old slot stops (ADR 0028). Until then the live
   * slot serves as before, so a version that fails never gets traffic.
   *
   * The new spec and compose file are staged next to the live ones and only committed once the
   * new slot is healthy, so an agent that stops mid-deploy restarts with the live slot's files
   * (`recover`).
   */
  async #rollOut(spec: AppSpec): Promise<AppStatus> {
    const databaseUrl = spec.database ? await this.#provision(spec.name) : undefined
    const previous = await this.#store.read(spec.name)
    const live = previous ? composeService(previous.compose) : undefined
    const slot = live === slotService(spec.name, 'blue') ? 'green' : 'blue'
    const service = slotService(spec.name, slot)
    await this.#store.stage(spec.name, {
      spec: `${JSON.stringify(spec, null, 2)}\n`,
      compose: renderCompose(spec, service, databaseUrl),
    })

    const pull = await this.#compose(spec.name, ['pull', '--quiet'], { staged: true })
    if (pull.code !== 0) {
      await this.#abandon(spec.name, service, previous)
      throw new AgentError(`Could not pull ${spec.image}:${spec.tag}`, 502, tail(pull))
    }
    // Only the new slot's service, and no --remove-orphans: the live slot's container isn't in
    // this compose file, and must keep running.
    const up = await this.#compose(
      spec.name,
      ['up', '-d', '--wait', '--wait-timeout', '120', service],
      {
        staged: true,
      },
    )
    if (up.code !== 0) {
      const logs = await this.#compose(spec.name, ['logs', '--tail', '50', '--no-color'], {
        staged: true,
      })
      await this.#abandon(spec.name, service, previous)
      throw new AgentError(
        `${spec.name} did not start or become healthy`,
        502,
        `${tail(up)}\n${tail(logs)}`,
      )
    }
    // The new slot is healthy: point the site at it, then commit. A restart before the commit
    // finds the old compose file, rewrites the site back and drops the new slot.
    await this.#store.writeSite(spec.name, renderSite(spec, this.settings, service))
    await this.#store.commit(spec.name)
    const reload = await this.#reloadCaddy()
    if (reload.code !== 0) {
      // Caddy still runs its previous configuration, so the old slot still serves.
      await this.#compose(spec.name, ['rm', '--stop', '--force', service])
      if (previous) await this.#store.write(spec.name, previous)
      else await this.#store.remove(spec.name)
      await this.#reloadCaddy()
      throw new AgentError('Caddy rejected the site configuration', 500, tail(reload))
    }
    // Traffic is on the new slot: the old one (or the single service of an app deployed before
    // slots) can go.
    await this.#removeOtherSlots(spec.name, service)
    return this.#status(spec)
  }

  /**
   * Gives up a deploy before its commit: removes the new slot's container and the staged files.
   * The live slot, its files and Caddy were never touched. An app that had no previous version
   * is removed altogether.
   */
  async #abandon(name: string, service: string, previous: AppFiles | undefined) {
    // A pull failure started nothing; `rm` then has nothing to do.
    await this.#compose(name, ['rm', '--stop', '--force', service], { staged: true })
    if (previous) await this.#store.discardStaged(name)
    else await this.#store.remove(name)
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
    return this.#exclusive(() => this.#refreshSites())
  }

  /**
   * What the agent does when it starts, before anything else (ADR 0028):
   * 1. locks down every app directory's env- and password-bearing files, as older agents left
   *    them readable by everyone, including directories that aren't a complete app;
   * 2. drops what a deploy interrupted before its commit had staged, and finishes a commit
   *    interrupted between its renames;
   * 3. rewrites the sites for the live slots and the current settings (`refreshSites`);
   * 4. removes containers of slots that aren't live: the new slot of an interrupted deploy, or
   *    the old one of a deploy that stopped before removing it. Caddy reloads first, so it no
   *    longer routes to them.
   * Throws if Caddy can't reload yet (it may still be starting); it is safe to call again.
   */
  recover(): Promise<string[]> {
    return this.#exclusive(async () => {
      for (const name of await this.#store.names()) {
        await this.#store.lockDown(name)
        if (await this.#store.recover(name)) await this.#store.discardStaged(name)
      }
      const changed = await this.#refreshSites()
      const strays: { name: string; live: string | undefined }[] = []
      const containers = await this.#containers()
      for (const name of await this.#store.names()) {
        const live = await this.#liveService(name)
        const rows = containers.get(projectName(name)) ?? []
        if (rows.some((row) => label(row, 'com.docker.compose.service') !== live)) {
          strays.push({ name, live })
        }
      }
      if (strays.length === 0) return changed
      // The previous agent may have committed a slot without reloading Caddy.
      const reload = await this.#reloadCaddy()
      if (reload.code !== 0) throw new AgentError('Caddy could not reload', 500, tail(reload))
      for (const { name, live } of strays) await this.#removeOtherSlots(name, live)
      return changed
    })
  }

  async #refreshSites(): Promise<string[]> {
    {
      const pending: { spec: AppSpec; files: AppFiles; site: string }[] = []
      for (const spec of await this.#store.list()) {
        // Compose files carry DATABASE_URL and app.json the env; older ones were written
        // readable by everyone.
        await this.#store.lockDown(spec.name)
        const files = await this.#store.read(spec.name)
        const service = files && composeService(files.compose)
        if (!files || !service) continue
        const site = renderSite(spec, this.settings, service)
        if (files.site !== site) pending.push({ spec, files, site })
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
    }
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
