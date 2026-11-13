import { NAME } from '@spotcraft/agent/app-spec'
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
  const { name } = params
  // The name goes into PromQL and agent URLs before the app is looked up: only valid names.
  if (!new RegExp(NAME).test(name)) error(404, 'No such app')
  // Everything starts at once; only the 404 waits for the app itself.
  const [app, cpu, memory, response, up, uptimeDay, uptimeWeek, logs] = await Promise.all([
    getApp(name),
    range(promql.appCpu(name)),
    range(promql.appMemory(name)),
    range(promql.appResponse(name)),
    instant(promql.appUp(name)),
    instant(promql.appUptime(name, '24h')),
    instant(promql.appUptime(name, '7d')),
    appLogs(name, 200),
  ])
  if (!app) error(404, 'No such app')
  // The domain's status asks Cloudflare (several calls): streamed, so the page doesn't wait.
  const domain = app.domain ? getDomainStatus(name).catch(() => undefined) : undefined
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
