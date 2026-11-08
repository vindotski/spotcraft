/** What the dashboard sends to deploy an app; stored as apps/<name>/app.json. */
export interface AppSpec {
  name: string
  image: string
  tag: string
  domain: string
  port: number
  env: Record<string, string>
  /** Docker memory limit, e.g. "512m" or "1g". */
  memory: string
  cpus: number
  /** Read-only root filesystem (with a small writable /tmp). */
  readOnly: boolean
  /** Its own Postgres role and database on the apps server, given to it as DATABASE_URL. */
  database: boolean
}

// Names end up in container names, network aliases and file paths.
export const NAME = '^[a-z][a-z0-9-]{0,30}[a-z0-9]$'
// Docker Hub style repository, optionally with a registry host (e.g. ghcr.io/org/app).
export const IMAGE = '^[a-z0-9]+([._-][a-z0-9]+)*(\\/[a-z0-9]+([._-][a-z0-9]+)*)*$'
export const TAG = '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$'
// A lower-case DNS name with at least two labels; it is written into the Caddyfile.
export const DOMAIN = '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$'
export const ENV_KEY = '^[A-Za-z_][A-Za-z0-9_]*$'
export const MEMORY = '^[1-9][0-9]{0,5}[mg]$'

/** Names the apps server's own services use; an app can't take them. */
export const RESERVED_NAMES = new Set(['caddy', 'agent', 'node-exporter', 'cadvisor', 'postgres'])

export const appBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['image', 'tag', 'domain'],
  properties: {
    image: { type: 'string', pattern: IMAGE, maxLength: 255 },
    tag: { type: 'string', pattern: TAG },
    domain: { type: 'string', pattern: DOMAIN },
    port: { type: 'integer', minimum: 1, maximum: 65535, default: 3000 },
    env: {
      type: 'object',
      default: {},
      maxProperties: 100,
      propertyNames: { pattern: ENV_KEY, maxLength: 128 },
      additionalProperties: { type: 'string', maxLength: 4096 },
    },
    memory: { type: 'string', pattern: MEMORY, default: '512m' },
    cpus: { type: 'number', minimum: 0.1, maximum: 64, default: 1 },
    readOnly: { type: 'boolean', default: true },
    // No default: left out, an update keeps the app's current setting (see the PUT route).
    database: { type: 'boolean' },
  },
} as const

/** The PUT body: everything but the name, and `database` may be left out. */
export type AppBody = Omit<AppSpec, 'name' | 'database'> & { database?: boolean }

export const nameParamsSchema = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', pattern: NAME } },
} as const
