import { access, chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSpec } from './app-spec.ts'
import type { BackupStatus } from './backups.ts'

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
  /** SHA-256 (hex) of the app's deploy hook token; the token itself is never stored (ADR 0029). */
  hookTokenHash?: string
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

  /** Every app directory, complete or not (a new app's first deploy has only staged files). */
  async names(): Promise<string[]> {
    try {
      return (await readdir(join(this.dataDir, 'apps'))).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async list(): Promise<AppSpec[]> {
    const specs = await Promise.all((await this.names()).map((name) => this.get(name)))
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

  /** The compose file of a deploy in progress, until it is committed (ADR 0028). */
  stagedComposePath(name: string) {
    return join(this.appDir(name), 'compose.next.yaml')
  }
  #stagedSpecPath(name: string) {
    return join(this.appDir(name), 'app.next.json')
  }

  /**
   * Writes a deploy's spec and compose file next to the live ones. The live files keep
   * describing the slot that serves, so an agent that stops mid-deploy restarts with them.
   */
  async stage(name: string, files: Omit<AppFiles, 'site'>) {
    await mkdir(this.appDir(name), { recursive: true })
    for (const [path, content] of [
      [this.#stagedSpecPath(name), files.spec],
      [this.stagedComposePath(name), files.compose],
    ] as const) {
      await writeFile(path, content, { mode: 0o600 })
      await chmod(path, 0o600)
    }
  }

  /**
   * Makes the staged files the live ones. Renaming the compose file is the commit: once it is
   * done, the new slot is the live one. The spec follows; `recover` finishes that rename if the
   * agent stopped in between.
   */
  async commit(name: string) {
    await rename(this.stagedComposePath(name), this.composePath(name))
    await rename(this.#stagedSpecPath(name), this.#specPath(name))
  }

  /** Drops a deploy's staged files. */
  async discardStaged(name: string) {
    await rm(this.stagedComposePath(name), { force: true })
    await rm(this.#stagedSpecPath(name), { force: true })
  }

  /**
   * After a restart: finishes a commit that stopped between its two renames, and returns the
   * staged compose file of a deploy that never committed (its slot must go), or undefined.
   */
  async recover(name: string): Promise<string | undefined> {
    const exists = (path: string) =>
      access(path).then(
        () => true,
        () => false,
      )
    if (await exists(this.stagedComposePath(name))) {
      return readFile(this.stagedComposePath(name), 'utf8')
    }
    if (await exists(this.#stagedSpecPath(name))) {
      await rename(this.#stagedSpecPath(name), this.#specPath(name))
    }
    return undefined
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

  /**
   * Makes the app's env- and password-bearing files the agent's alone, as older agents didn't.
   * Works on whichever of them exist, so an incomplete app directory is fixed too.
   */
  async lockDown(name: string) {
    for (const path of [
      this.#specPath(name),
      this.composePath(name),
      this.#secretsPath(name),
      this.#stagedSpecPath(name),
      this.stagedComposePath(name),
    ]) {
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

  /** The files a backup keeps of the app, as they are on disk; undefined if one is missing. */
  async backupFiles(name: string): Promise<{ spec: string; secrets: string } | undefined> {
    const spec = await readFile(this.#specPath(name), 'utf8').catch(() => undefined)
    if (spec === undefined) return undefined
    const secrets = await readFile(this.#secretsPath(name), 'utf8').catch(() => '{}\n')
    return { spec, secrets }
  }

  #backupStatusPath(name: string) {
    return join(this.appDir(name), 'backup.json')
  }

  /** The app's last backup; undefined if there was none, or its file can't be read. */
  async readBackupStatus(name: string): Promise<BackupStatus | undefined> {
    try {
      return JSON.parse(await readFile(this.#backupStatusPath(name), 'utf8')) as BackupStatus
    } catch {
      // Missing, or cut short: the next backup writes it afresh.
      return undefined
    }
  }

  /** Written next to it, then renamed: a reader never sees half a file. */
  async writeBackupStatus(name: string, status: BackupStatus) {
    const path = this.#backupStatusPath(name)
    await writeFile(`${path}.next`, `${JSON.stringify(status, null, 2)}\n`)
    await rename(`${path}.next`, path)
  }

  async remove(name: string) {
    await rm(this.sitePath(name), { force: true })
    await rm(this.appDir(name), { recursive: true, force: true })
  }
}
