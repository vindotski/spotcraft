import { appDatabaseName, provision, purge } from '@spotcraft/kit/provision'
import type { Databases } from './apps.ts'

/**
 * App databases on the apps server's Postgres, managed as the agent's role (`adminUrl`, e.g.
 * `postgres://spotcraft_agent:…@postgres:5432/postgres`). Apps reach the same server by the
 * same host name, on the network they share with it.
 */
export function postgresDatabases(adminUrl: string): Databases {
  return {
    async provision(name, password) {
      await provision(adminUrl, { name, password })
      const url = new URL(adminUrl)
      url.username = appDatabaseName(name)
      url.password = password
      url.pathname = `/${appDatabaseName(name)}`
      url.search = ''
      return url.toString()
    },
    purge: (name) => purge(adminUrl, name),
  }
}
