import { AccessApps } from './access.ts'
import { buildApp } from './app.ts'
import { Apps } from './apps.ts'
import { dockerDump, untilNext } from './backups.ts'
import { CloudflareApi } from './cloudflare.ts'
import { loadConfig } from './config.ts'
import { postgresDatabases } from './databases.ts'
import { Domains } from './domains.ts'
import { execRunner } from './runner.ts'
import { S3 } from './s3.ts'
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
  { appsDomain: config.appsDomain, dashboardDomain: config.dashboardDomain, edge: config.edge },
  cloudflare,
  config.backup && {
    target: new S3(config.backup),
    dump: dockerDump(config.backup.postgresContainer),
  },
)
const app = buildApp({
  token: config.token,
  apps,
  allowedIps: config.allowedIps,
  logger: { level: config.logLevel },
})

for (const notice of config.notices) app.log.warn(notice)

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

// Recover from a deploy the previous agent didn't finish, lock down older app files, and
// rewrite every app's site (sites follow EDGE and APPS_DOMAIN, which may have changed). Caddy
// may still be starting (both start in the same deploy), so a failed reload is retried.
for (let attempt = 1; attempt <= 24; attempt++) {
  try {
    const changed = await apps.recover()
    if (changed.length > 0)
      app.log.info({ changed }, 'app sites rewritten for the current settings')
    break
  } catch (error) {
    if (attempt === 24) {
      app.log.error({ err: error }, 'gave up rewriting app sites')
      break
    }
    app.log.warn({ attempt }, 'could not reload Caddy with rewritten sites; retrying')
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

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

// Every night at 03:00 UTC, back up every app (ADR 0030). Each app's result is kept in its
// backup.json, which the dashboard shows; failures are also logged.
const BACKUP_HOUR_UTC = 3
if (config.backup) {
  const nightly = async () => {
    try {
      const results = await apps.backupAll()
      const failed = Object.entries(results).filter(([, status]) => !status.ok)
      if (failed.length > 0)
        app.log.error({ failed: failed.map(([name]) => name) }, 'backups failed')
      else app.log.info({ apps: Object.keys(results) }, 'backups done')
    } catch (error) {
      app.log.error({ err: error }, 'backups could not run')
    }
    setTimeout(nightly, untilNext(BACKUP_HOUR_UTC)).unref()
  }
  setTimeout(nightly, untilNext(BACKUP_HOUR_UTC)).unref()
  app.log.info({ bucket: config.backup.bucket }, 'nightly backups at 03:00 UTC')
}
