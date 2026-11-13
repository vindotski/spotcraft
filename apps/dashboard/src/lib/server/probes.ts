import { rename, writeFile } from 'node:fs/promises'
import { PROBES_FILE } from '$app/env/private'
import type { AppStatus } from './agent.ts'

/**
 * Writes vmagent's file_sd targets: an HTTPS uptime probe for each host of each app (its default
 * host and its custom domain), labelled with the app name. Written atomically (temp file +
 * rename) so vmagent never reads half a file.
 */
export async function writeProbes(apps: Pick<AppStatus, 'name' | 'hostnames' | 'protected'>[]) {
  if (!PROBES_FILE) return
  // A protected app answers with Cloudflare Access's redirect (blackbox's http_access module).
  const targets = apps.map((app) => ({
    targets: app.hostnames.map((host) => `https://${host}`),
    labels: app.protected ? { app: app.name, module: 'http_access' } : { app: app.name },
  }))
  const temp = `${PROBES_FILE}.tmp`
  await writeFile(temp, `${JSON.stringify(targets, null, 2)}\n`)
  await rename(temp, PROBES_FILE)
}
