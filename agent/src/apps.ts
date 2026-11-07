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

const tail = (result: RunResult) => `${result.stdout}\n${result.stderr}`.trim().slice(-4000)

/** Deploys and removes apps. One change at a time; reads run freely. */
export class Apps {
  readonly #store: Store
  readonly #run: Runner
  readonly #caddyContainer: string
  #queue: Promise<unknown> = Promise.resolve()

  constructor(store: Store, run: Runner, caddyContainer: string) {
    this.#store = store
    this.#run = run
    this.#caddyContainer = caddyContainer
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
    return Promise.all(specs.map((spec) => this.#withStatus(spec)))
  }

  async get(name: string): Promise<AppStatus | undefined> {
    const spec = await this.#store.get(name)
    return spec ? this.#withStatus(spec) : undefined
  }

  async #withStatus(spec: AppSpec): Promise<AppStatus> {
    const result = await this.#compose(spec.name, ['ps', '--all', '--format', 'json'])
    // Newer Compose prints one JSON object per line; older prints an array.
    const text = result.stdout.trim()
    const rows: Array<Record<string, string>> = text.startsWith('[')
      ? JSON.parse(text)
      : text
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
    const row = rows[0]
    return {
      ...spec,
      state: row?.State ?? 'missing',
      health: row?.Health ?? '',
      status: row?.Status ?? '',
    }
  }

  /** Writes the app's files and rolls it out; on failure, puts the previous version back. */
  deploy(spec: AppSpec): Promise<AppStatus> {
    return this.#exclusive(async () => {
      const previous = await this.#store.read(spec.name)
      const next = {
        spec: `${JSON.stringify(spec, null, 2)}\n`,
        compose: renderCompose(spec),
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
      return this.#withStatus(spec)
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

  remove(name: string): Promise<boolean> {
    return this.#exclusive(async () => {
      if (!(await this.#store.read(name))) return false
      const down = await this.#compose(name, ['down', '--remove-orphans'])
      if (down.code !== 0) throw new AgentError(`Could not stop ${name}`, 500, tail(down))
      await this.#store.remove(name)
      await this.#reloadCaddy()
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
