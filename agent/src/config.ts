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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.AGENT_TOKEN ?? ''
  if (token.length < 32) throw new Error('AGENT_TOKEN must be set and at least 32 characters long')
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
  }
}
