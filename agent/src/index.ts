import { buildApp } from './app.ts'
import { Apps } from './apps.ts'
import { loadConfig } from './config.ts'
import { execRunner } from './runner.ts'
import { Store } from './store.ts'

const config = loadConfig()
const apps = new Apps(new Store(config.dataDir), execRunner, config.caddyContainer)
const app = buildApp({ token: config.token, apps, logger: { level: config.logLevel } })

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
