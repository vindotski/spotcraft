import { AgentUnavailable, type AppStatus, listApps } from '#lib/server/agent.ts'
import { instantBy, promql } from '#lib/server/metrics.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { PageServerLoad } from './$types'

interface AppsPage {
  apps: AppStatus[]
  uptime: Record<string, number>
  agentError: string | null
}

export const load: PageServerLoad = async (): Promise<AppsPage> => {
  try {
    const [apps, uptime] = await Promise.all([
      listApps(),
      instantBy(promql.uptimeByApp('24h'), 'app'),
    ])
    // Keep uptime probes in step with the app list, even if an app was changed elsewhere.
    await writeProbes(apps).catch(() => {})
    return { apps, uptime, agentError: null }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return { apps: [], uptime: {}, agentError: message }
  }
}
