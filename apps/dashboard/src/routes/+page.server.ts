import {
  AgentUnavailable,
  type AppStatus,
  type BackupStatus,
  getBackups,
  listApps,
} from '#lib/server/agent.ts'
import { instantBy, promql } from '#lib/server/metrics.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { PageServerLoad } from './$types'

interface AppsPage {
  apps: AppStatus[]
  uptime: Record<string, number>
  /**
   * Each app's last backup, when backups are set up (ADR 0030); `unavailable` when the agent
   * couldn't say, which the page shows rather than hiding the column.
   */
  backups: Record<string, BackupStatus | null> | null | 'unavailable'
  agentError: string | null
}

export const load: PageServerLoad = async (): Promise<AppsPage> => {
  try {
    const [apps, uptime, backups] = await Promise.all([
      listApps(),
      instantBy(promql.uptimeByApp('24h'), 'app'),
      getBackups().catch(() => 'unavailable' as const),
    ])
    // Keep uptime probes in step with the app list, even if an app was changed elsewhere.
    await writeProbes(apps).catch(() => {})
    const shown = backups === 'unavailable' ? backups : backups.enabled ? backups.apps : null
    return { apps, uptime, backups: shown, agentError: null }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return { apps: [], uptime: {}, backups: null, agentError: message }
  }
}
