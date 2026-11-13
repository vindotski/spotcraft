import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSpec } from './app-spec.ts'

/** Everything the server knows about one app; the files are the only record. */
export interface AppFiles {
  spec: string
  compose: string
  site: string
}

/** Values the agent generates for an app and never returns over the API. */
export interface AppSecrets {
  /** Password of the app's Postgres role. */
  databasePassword?: string
}

export class Store {
  readonly dataDir: string
  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  appDir(name: string) {
    return join(this.dataDir, 'apps', name)
  }
  composePath(name: string) {
    return join(this.appDir(name), 'compose.yaml')
  }
  sitePath(name: string) {
    return join(this.dataDir, 'sites', `${name}.caddy`)
  }

  async list(): Promise<AppSpec[]> {
    let names: string[]
    try {
      names = await readdir(join(this.dataDir, 'apps'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const specs = await Promise.all(names.sort().map((name) => this.get(name)))
    return specs.filter((spec): spec is AppSpec => spec !== undefined)
  }

  async get(name: string): Promise<AppSpec | undefined> {
    const files = await this.read(name)
    return files ? (JSON.parse(files.spec) as AppSpec) : undefined
  }

  async read(name: string): Promise<AppFiles | undefined> {
    try {
      const [spec, compose, site] = await Promise.all([
        readFile(this.#specPath(name), 'utf8'),
        readFile(this.composePath(name), 'utf8'),
        readFile(this.sitePath(name), 'utf8'),
      ])
      return { spec, compose, site }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async write(name: string, files: AppFiles) {
    await mkdir(this.appDir(name), { recursive: true })
    await mkdir(join(this.dataDir, 'sites'), { recursive: true })
    // app.json carries the app's env (AUTH_SECRET and the like) and compose.yaml also
    // DATABASE_URL, with the app's database password: the agent's user only, like secrets.json
    // (chmod as well: the mode only applies when the file is created).
    for (const [path, content] of [
      [this.#specPath(name), files.spec],
      [this.composePath(name), files.compose],
    ] as const) {
      await writeFile(path, content, { mode: 0o600 })
      await chmod(path, 0o600)
    }
    await this.writeSite(name, files.site)
  }

  /** Only the Caddy site, e.g. once a new slot is healthy and traffic can move to it. */
  async writeSite(name: string, site: string) {
    await mkdir(join(this.dataDir, 'sites'), { recursive: true })
    await writeFile(this.sitePath(name), site)
  }

  #specPath(name: string) {
    return join(this.appDir(name), 'app.json')
  }

  #secretsPath(name: string) {
    return join(this.appDir(name), 'secrets.json')
  }

  async readSecrets(name: string): Promise<AppSecrets> {
    try {
      return JSON.parse(await readFile(this.#secretsPath(name), 'utf8')) as AppSecrets
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  /** Makes the app's app.json and compose file the agent's alone, as older agents didn't. */
  async lockDown(name: string) {
    for (const path of [this.#specPath(name), this.composePath(name)]) {
      await chmod(path, 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  /** Readable by the agent's user only. */
  async writeSecrets(name: string, secrets: AppSecrets) {
    await mkdir(this.appDir(name), { recursive: true })
    await writeFile(this.#secretsPath(name), `${JSON.stringify(secrets, null, 2)}\n`, {
      mode: 0o600,
    })
    await chmod(this.#secretsPath(name), 0o600)
  }

  async remove(name: string) {
    await rm(this.sitePath(name), { force: true })
    await rm(this.appDir(name), { recursive: true, force: true })
  }
}
