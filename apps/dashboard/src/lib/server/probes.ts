import { rename, writeFile } from 'node:fs/promises'
import { PROBES_FILE } from '$app/env/private'
import type { AppStatus } from './agent.ts'

/**
 * Writes vmagent's file_sd targets: one HTTPS uptime probe per app domain, labelled with the
 * app name. Written atomically (temp file + rename) so vmagent never reads half a file.
 */
export async function writeProbes(apps: Pick<AppStatus, 'name' | 'domain'>[]) {
  if (!PROBES_FILE) return
  const targets = apps.map((app) => ({
    targets: [`https://${app.domain}`],
    labels: { app: app.name },
  }))
  const temp = `${PROBES_FILE}.tmp`
  await writeFile(temp, `${JSON.stringify(targets, null, 2)}\n`)
  await rename(temp, PROBES_FILE)
}
