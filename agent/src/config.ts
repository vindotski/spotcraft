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
}

const HEX32 = /^[0-9a-f]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function loadCloudflare(env: NodeJS.ProcessEnv, edge: Edge, appsDomain: string | undefined) {
  const values = {
    apiToken: env.CLOUDFLARE_API_TOKEN?.trim() ?? '',
    accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '',
    appsZoneId: env.CLOUDFLARE_APPS_ZONE_ID?.trim() ?? '',
    tunnelId: env.CLOUDFLARE_TUNNEL_ID?.trim() ?? '',
  }
  if (!values.apiToken) return undefined
  if (edge !== 'cloudflare' || !appsDomain) {
    throw new Error('CLOUDFLARE_API_TOKEN needs EDGE=cloudflare and APPS_DOMAIN')
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
    edge,
    cloudflare: loadCloudflare(env, edge, appsDomain),
  }
}
