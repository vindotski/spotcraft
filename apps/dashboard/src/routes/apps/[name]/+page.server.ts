import { error, fail, redirect } from '@sveltejs/kit'
import { appLogs, deployApp, getApp, listApps, removeApp } from '#lib/server/agent.ts'
import { instant, promql, range } from '#lib/server/metrics.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const app = await getApp(params.name)
  if (!app) error(404, 'No such app')
  const [cpu, memory, response, up, uptimeDay, uptimeWeek, logs] = await Promise.all([
    range(promql.appCpu(app.name)),
    range(promql.appMemory(app.name)),
    range(promql.appResponse(app.name)),
    instant(promql.appUp(app.name)),
    instant(promql.appUptime(app.name, '24h')),
    instant(promql.appUptime(app.name, '7d')),
    appLogs(app.name, 200),
  ])
  return { app, metrics: { cpu, memory, response, up, uptimeDay, uptimeWeek }, logs }
}

export const actions: Actions = {
  // Same settings again: pulls the tag (picks up a re-pushed `latest`) and restarts the app.
  redeploy: async ({ params }) => {
    const app = await getApp(params.name)
    if (!app) error(404, 'No such app')
    const { name, state, health, status, ...input } = app
    const result = await deployApp(name, input)
    if (!result.ok) return fail(502, { deployError: result.error, output: result.output })
    return { redeployed: true }
  },
  remove: async ({ params }) => {
    await removeApp(params.name)
    await writeProbes(await listApps()).catch(() => {})
    redirect(303, '/')
  },
}
