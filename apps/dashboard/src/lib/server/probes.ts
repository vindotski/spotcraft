import { rename, writeFile } from 'node:fs/promises'
import { PROBES_FILE } from '$app/env/private'
import type { AppStatus } from './agent.ts'
import { probeTargets } from './probe-targets.ts'

/** Writes the probe targets atomically (temp file + rename), so vmagent never reads half a file. */
export async function writeProbes(apps: Pick<AppStatus, 'name' | 'hostnames' | 'protected'>[]) {
  if (!PROBES_FILE) return
  const tmp = `${PROBES_FILE}.tmp`
  await writeFile(tmp, `${JSON.stringify(probeTargets(apps), null, 2)}\n`)
  await rename(tmp, PROBES_FILE)
}
