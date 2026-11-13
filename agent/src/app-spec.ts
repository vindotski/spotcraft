/** What the dashboard sends to deploy an app; stored as apps/<name>/app.json. */
export interface AppSpec {
  name: string
  image: string
  tag: string
  /**
   * The app's custom domain, if any. Every app is also served at `<name>.<APPS_DOMAIN>`
   * when the agent has an APPS_DOMAIN (ADR 0021); without one, a domain is required.
   */
  domain?: string
  port: number
  env: Record<string, string>
  /** Docker memory limit, e.g. "512m" or "1g". */
  memory: string
  cpus: number
  /** Read-only root filesystem (with a small writable /tmp). */
  readOnly: boolean
  /** Its own Postgres role and database on the server, given to it as DATABASE_URL. */
  database: boolean
  /** Behind Cloudflare Access: visitors sign in as one of the owners first (ADR 0021). */
  protected?: boolean
  /**
   * Every deploy may replace the custom domain's A, AAAA and CNAME records that Spotcraft
   * didn't make, e.g. ones pointing at an old server (ADR 0022).
   */
  takeOver?: boolean
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

/**
 * Names an app can't take: the server's own services use them, or (as `<name>.<APPS_DOMAIN>`)
 * they would clash with hosts the apps domain keeps for itself (ADR 0021).
 */
export const RESERVED_NAMES = new Set([
  'caddy',
  'agent',
  'node-exporter',
  'cadvisor',
  'postgres',
  'www',
  'fallback',
])

/** The host every app gets on the apps domain, e.g. `tagtape.spotcraft.dev`. */
export const defaultHost = (name: string, appsDomain: string) => `${name}.${appsDomain}`

/** Every host the app answers on: its default host (if there is an apps domain) and its domain. */
export function hostnames(app: Pick<AppSpec, 'name' | 'domain'>, appsDomain?: string): string[] {
  const hosts = appsDomain ? [defaultHost(app.name, appsDomain)] : []
  if (app.domain && !hosts.includes(app.domain)) hosts.push(app.domain)
  return hosts
}

export const appBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['image', 'tag'],
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
    // Like `database`: left out, an update keeps the current setting.
    protected: { type: 'boolean' },
    // Like `database`: left out, an update keeps the current setting.
    takeOver: { type: 'boolean' },
  },
} as const

/** The PUT body: everything but the name; `database`, `protected` and `takeOver` may be left out. */
export type AppBody = Omit<AppSpec, 'name' | 'database'> & { database?: boolean }

/** How traffic reaches the server (ADR 0021). */
export type Edge = 'direct' | 'cloudflare'

/** What the agent serves apps under; the dashboard reads it from `GET /settings`. */
export interface AgentSettings {
  /** Apex of the zone every app gets a subdomain of; absent when the server has none. */
  appsDomain?: string
  /** `direct`: Caddy is public and gets certificates. `cloudflare`: behind a Cloudflare Tunnel. */
  edge: Edge
  /** The agent sets up custom domains' DNS through the Cloudflare API itself. */
  dns?: boolean
  /** Apps can be put behind Cloudflare Access. */
  access?: boolean
}

/** The custom-domain hosts the agent sets up: the domain, and `www.` for a root domain. */
export function customHosts(app: Pick<AppSpec, 'domain'>): string[] {
  if (!app.domain) return []
  return app.domain.split('.').length === 2 ? [app.domain, `www.${app.domain}`] : [app.domain]
}

/**
 * Every host Caddy, DNS and Access handle for the app: its hostnames plus `www.` of a root
 * custom domain (which redirects). No two apps may share any of them.
 */
export function servedHosts(app: Pick<AppSpec, 'name' | 'domain'>, appsDomain?: string): string[] {
  const hosts = hostnames(app, appsDomain)
  return [...hosts, ...customHosts(app).filter((host) => !hosts.includes(host))]
}

/** A DNS record someone has to create, as the dashboard shows it. */
export interface DnsInstruction {
  type: 'CNAME' | 'TXT' | 'A/AAAA'
  name: string
  value: string
}

/**
 * How one custom host reaches the app (ADR 0021):
 * - `zone`: its zone is in the Cloudflare account; Spotcraft made a proxied CNAME to the tunnel.
 * - `saas`: anywhere else; a Cloudflare for SaaS custom hostname, waiting for the owner's CNAME.
 * - `manual`: Spotcraft doesn't manage DNS; `records` says what to create.
 */
export interface HostStatus {
  host: string
  mode: 'zone' | 'saas' | 'manual'
  /** `active` once traffic can arrive; `pending` while Cloudflare waits for DNS or a certificate. */
  state: 'active' | 'pending' | 'missing' | 'unknown'
  detail?: string
  records: DnsInstruction[]
}

/** `GET /apps/:name/domain`. */
export interface DomainStatus {
  /** What a custom domain's CNAME points at: the app's default host. */
  target?: string
  hosts: HostStatus[]
}

export const nameParamsSchema = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', pattern: NAME } },
} as const
