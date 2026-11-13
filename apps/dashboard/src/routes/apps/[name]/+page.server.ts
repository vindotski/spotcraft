import { error, fail, redirect } from '@sveltejs/kit'
import {
  appLogs,
  deployApp,
  getApp,
  getDomainStatus,
  listApps,
  removeApp,
} from '#lib/server/agent.ts'
import { instant, promql, range } from '#lib/server/metrics.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const app = await getApp(params.name)
  if (!app) error(404, 'No such app')
  const [cpu, memory, response, up, uptimeDay, uptimeWeek, logs, domain] = await Promise.all([
    range(promql.appCpu(app.name)),
    range(promql.appMemory(app.name)),
    range(promql.appResponse(app.name)),
    instant(promql.appUp(app.name)),
    instant(promql.appUptime(app.name, '24h')),
    instant(promql.appUptime(app.name, '7d')),
    appLogs(app.name, 200),
    app.domain ? getDomainStatus(app.name).catch(() => undefined) : undefined,
  ])
  return { app, metrics: { cpu, memory, response, up, uptimeDay, uptimeWeek }, logs, domain }
}

export const actions: Actions = {
  // Same settings again: pulls the tag (picks up a re-pushed `latest`) and restarts the app.
  redeploy: async ({ params }) => {
    const app = await getApp(params.name)
    if (!app) error(404, 'No such app')
    const { name, state, health, status, hostnames, ...input } = app
    const result = await deployApp(name, input)
    if (!result.ok) return fail(502, { deployError: result.error, output: result.output })
    return { redeployed: true }
  },
  remove: async ({ params, request }) => {
    const purge = (await request.formData()).get('purge') === 'on'
    try {
      await removeApp(params.name, { purge })
    } catch (cause) {
      // E.g. the app was removed but its database could not be deleted: say exactly that.
      error(502, cause instanceof Error ? cause.message : 'The agent could not remove the app')
    } finally {
      await writeProbes(await listApps()).catch(() => {})
    }
    redirect(303, '/')
  },
}
