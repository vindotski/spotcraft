import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appDatabaseName } from '@spotcraft/kit/provision'

/**
 * The app's name: `--name`, or else the `name` in package.json, made into a Spotcraft app
 * name (`@acme/Blog_API` → `blog-api`). Throws when neither gives a valid one.
 */
export async function appName(dir: string, flag?: string): Promise<string> {
  let candidate = flag
  if (!candidate) {
    let pkg: { name?: unknown }
    try {
      pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    } catch {
      throw new Error('No package.json here; pass the app name with --name')
    }
    if (typeof pkg.name !== 'string') throw new Error('package.json has no name; pass --name')
    candidate = pkg.name
      .replace(/^@[^/]+\//, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^[^a-z]+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '')
  }
  try {
    appDatabaseName(candidate)
  } catch {
    throw new Error(
      `"${candidate}" is not a Spotcraft app name (lower-case letters, digits and dashes, 2–32 characters); pass --name`,
    )
  }
  return candidate
}

/** KEY=value lines of a .env file (comments and blank lines skipped). */
export function parseEnv(text: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
    if (match) entries.set(match[1], match[2].trim())
  }
  return entries
}

async function readEnvFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/** The local settings an app needs; AUTH_SECRET is kept if .env already has one. */
export async function localEnv(dir: string, databaseUrl: string): Promise<Map<string, string>> {
  const existing = parseEnv(await readEnvFile(join(dir, '.env')))
  return new Map([
    ['DATABASE_URL', databaseUrl],
    ['AUTH_SECRET', existing.get('AUTH_SECRET') || randomBytes(32).toString('hex')],
  ])
}

/**
 * Adds the variables .env doesn't have yet, at the end, and leaves every existing line alone.
 * Returns which were added and which were already there (possibly with another value).
 */
export async function writeMissing(
  dir: string,
  values: Map<string, string>,
): Promise<{ added: string[]; kept: string[] }> {
  const path = join(dir, '.env')
  const text = await readEnvFile(path)
  const existing = parseEnv(text)
  const added = [...values.keys()].filter((key) => !existing.has(key))
  const kept = [...values.keys()].filter((key) => existing.has(key))
  if (added.length > 0) {
    const lines = added.map((key) => `${key}=${values.get(key)}`)
    const separator = text === '' || text.endsWith('\n') ? '' : '\n'
    const header = '# Local stack (npx spotcraft dev env --write)\n'
    await writeFile(path, `${text}${separator}${header}${lines.join('\n')}\n`)
  }
  return { added, kept }
}
