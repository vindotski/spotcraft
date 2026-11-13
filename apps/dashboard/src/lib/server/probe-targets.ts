import type { AppStatus } from './agent.ts'

/**
 * vmagent's file_sd targets: an HTTPS uptime probe for each host of each app (its default host
 * and its custom domain), labelled with the app name. A protected app answers with Cloudflare
 * Access's redirect, so its targets use blackbox's http_access module.
 */
export function probeTargets(apps: Pick<AppStatus, 'name' | 'hostnames' | 'protected'>[]) {
  return apps.map((app) => ({
    targets: app.hostnames.map((host) => `https://${host}`),
    labels: app.protected ? { app: app.name, module: 'http_access' } : { app: app.name },
  }))
}
