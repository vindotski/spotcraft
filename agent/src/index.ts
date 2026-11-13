import { AccessApps } from './access.ts'
import { buildApp } from './app.ts'
import { Apps } from './apps.ts'
import { CloudflareApi } from './cloudflare.ts'
import { loadConfig } from './config.ts'
import { postgresDatabases } from './databases.ts'
import { Domains } from './domains.ts'
import { execRunner } from './runner.ts'
import { Store } from './store.ts'

const config = loadConfig()
const databases = config.postgresUrl ? postgresDatabases(config.postgresUrl) : undefined
const cf = config.cloudflare
const api = cf ? new CloudflareApi(cf.apiToken, cf.accountId) : undefined
const cloudflare =
  cf && api
    ? {
        domains: new Domains({ api, appsZoneId: cf.appsZoneId, tunnelId: cf.tunnelId }),
        access: cf.accessPolicyId ? new AccessApps(api, cf.accessPolicyId) : undefined,
      }
    : undefined
const apps = new Apps(
  new Store(config.dataDir),
  execRunner,
  config.caddyContainer,
  databases,
  { appsDomain: config.appsDomain, edge: config.edge },
  cloudflare,
)
const app = buildApp({
  token: config.token,
  apps,
  allowedIps: config.allowedIps,
  logger: { level: config.logLevel },
})

// Finish in-flight requests (a deploy may be running) before exiting on stop.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}

await app.listen({ host: config.host, port: config.port })

// After an upgrade, bring every app database up to date. Postgres may still be starting
// (both start in the same deploy), so failures are retried for a few minutes.
if (databases) {
  for (let attempt = 1; attempt <= 36; attempt++) {
    const { upgraded, failed } = await apps.upgradeDatabases()
    if (failed.length === 0) {
      if (upgraded.length > 0) app.log.info({ upgraded }, 'app databases up to date')
      break
    }
    if (attempt === 36) {
      app.log.error({ failed }, 'gave up bringing app databases up to date')
      break
    }
    app.log.warn({ failed, attempt }, 'app databases not up to date yet; retrying')
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}
