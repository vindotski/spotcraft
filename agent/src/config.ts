import { DOMAIN, type Edge } from './app-spec.ts'

export interface Config {
  host: string
  port: number
  logLevel: string
  /** Bearer token the dashboard sends; at least 32 characters. */
  token: string
  /** Holds apps/<name>/{app.json,compose.yaml} and sites/<name>.caddy. */
  dataDir: string
  /** Container whose Caddy is reloaded after a site file changes. */
  caddyContainer: string
  /** Client addresses allowed to call the agent (the dashboard's server); empty allows any. */
  allowedIps: string[]
  /** The agent's Postgres role, for app databases; without it apps can't have one. */
  postgresUrl: string | undefined
  /** Zone apex every app gets a subdomain of (`<name>.<appsDomain>`); optional (ADR 0021). */
  appsDomain: string | undefined
  /** The dashboard's host on the same Caddy; apps can't use it (ADR 0026). */
  dashboardDomain: string | undefined
  /** `cloudflare` when a Cloudflare Tunnel delivers the traffic and Caddy serves plain HTTP. */
  edge: Edge
  /** Set together: the agent then manages custom domains' DNS through Cloudflare (ADR 0021). */
  cloudflare:
    | {
        apiToken: string
        accountId: string
        appsZoneId: string
        tunnelId: string
        /** The owners' reusable Access policy; without it, apps can't be protected. */
        accessPolicyId: string | undefined
      }
    | undefined
  /** Set together: apps are backed up every night to this bucket (ADR 0030). */
  backup:
    | {
        endpoint: string
        bucket: string
        accessKeyId: string
        secretAccessKey: string
        /** The Postgres container, where `pg_dump` runs. */
        postgresContainer: string
      }
    | undefined
  /** Settings that are present but have no effect, worth a line in the log at startup. */
  notices: string[]
}

const HEX32 = /^[0-9a-f]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function loadCloudflare(
  env: NodeJS.ProcessEnv,
  edge: Edge,
  appsDomain: string | undefined,
  notices: string[],
) {
  const values = {
    apiToken: env.CLOUDFLARE_API_TOKEN?.trim() ?? '',
    accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '',
    appsZoneId: env.CLOUDFLARE_APPS_ZONE_ID?.trim() ?? '',
    tunnelId: env.CLOUDFLARE_TUNNEL_ID?.trim() ?? '',
  }
  if (!values.apiToken) return undefined
  // Set ahead of a switch to Cloudflare (or left after switching back): unused, not fatal.
  if (edge !== 'cloudflare' || !appsDomain) {
    notices.push(
      'CLOUDFLARE_API_TOKEN is set but unused: custom domains through Cloudflare need EDGE=cloudflare and APPS_DOMAIN',
    )
    return undefined
  }
  if (!HEX32.test(values.accountId))
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be 32 hex characters')
  if (!HEX32.test(values.appsZoneId))
    throw new Error('CLOUDFLARE_APPS_ZONE_ID must be 32 hex characters')
  if (!UUID.test(values.tunnelId)) throw new Error("CLOUDFLARE_TUNNEL_ID must be the tunnel's UUID")
  const accessPolicyId = env.CLOUDFLARE_ACCESS_POLICY_ID?.trim() || undefined
  if (accessPolicyId && !UUID.test(accessPolicyId)) {
    throw new Error("CLOUDFLARE_ACCESS_POLICY_ID must be the policy's UUID")
  }
  return { ...values, accessPolicyId }
}

function loadBackup(env: NodeJS.ProcessEnv): Config['backup'] {
  const values = {
    endpoint: env.BACKUP_S3_ENDPOINT?.trim() ?? '',
    bucket: env.BACKUP_BUCKET?.trim() ?? '',
    accessKeyId: env.BACKUP_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: env.BACKUP_SECRET_ACCESS_KEY?.trim() ?? '',
  }
  const set = Object.values(values).filter(Boolean).length
  if (set === 0) return undefined
  if (set < 4) {
    throw new Error(
      'Set all of BACKUP_S3_ENDPOINT, BACKUP_BUCKET, BACKUP_ACCESS_KEY_ID and BACKUP_SECRET_ACCESS_KEY, or none',
    )
  }
  const url = URL.canParse(values.endpoint) ? new URL(values.endpoint) : undefined
  if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.search) {
    throw new Error(
      'BACKUP_S3_ENDPOINT must be an https:// origin, e.g. https://<account>.r2.cloudflarestorage.com',
    )
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values.bucket)) {
    throw new Error(
      'BACKUP_BUCKET must be a bucket name (lower-case letters, digits, dots, dashes)',
    )
  }
  return {
    ...values,
    endpoint: url.origin,
    postgresContainer: env.POSTGRES_CONTAINER?.trim() || 'spotcraft-apps-postgres-1',
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.AGENT_TOKEN ?? ''
  if (token.length < 32) throw new Error('AGENT_TOKEN must be set and at least 32 characters long')
  const postgresUrl = env.POSTGRES_URL || undefined
  if (postgresUrl) {
    const url = URL.canParse(postgresUrl) ? new URL(postgresUrl) : undefined
    if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !url.username) {
      throw new Error('POSTGRES_URL must be a postgres:// URL with a user')
    }
  }
  const appsDomain = env.APPS_DOMAIN?.trim().toLowerCase() || undefined
  if (appsDomain && !new RegExp(DOMAIN).test(appsDomain)) {
    throw new Error('APPS_DOMAIN must be a domain like apps.example.com, without https://')
  }
  const dashboardDomain = env.DASHBOARD_DOMAIN?.trim().toLowerCase() || undefined
  if (dashboardDomain && !new RegExp(DOMAIN).test(dashboardDomain)) {
    throw new Error('DASHBOARD_DOMAIN must be a domain like dash.example.com, without https://')
  }
  const notices: string[] = []
  const edge = env.EDGE || 'direct'
  if (edge !== 'direct' && edge !== 'cloudflare') {
    throw new Error('EDGE must be "direct" or "cloudflare"')
  }
  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 4000),
    logLevel: env.LOG_LEVEL ?? 'info',
    token,
    dataDir: env.DATA_DIR ?? '/opt/spotcraft',
    caddyContainer: env.CADDY_CONTAINER ?? 'spotcraft-apps-caddy-1',
    allowedIps: (env.AGENT_ALLOWED_IPS ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    postgresUrl,
    appsDomain,
    dashboardDomain,
    edge,
    cloudflare: loadCloudflare(env, edge, appsDomain, notices),
    backup: loadBackup(env),
    notices,
  }
}
