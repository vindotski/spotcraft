import { error, fail, redirect } from '@sveltejs/kit'
import { deployApp, getApp, getSettings, listApps } from '#lib/server/agent.ts'
import { envToText, parseAppForm } from '#lib/server/app-form.ts'
import { dockerHubTags } from '#lib/server/dockerhub.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const [app, settings] = await Promise.all([getApp(params.name), getSettings()])
  if (!app) error(404, 'No such app')
  return {
    appsDomain: settings.appsDomain,
    dns: settings.dns,
    access: settings.access,
    values: {
      name: app.name,
      image: app.image,
      tag: app.tag,
      domain: app.domain ?? '',
      port: String(app.port),
      memory: app.memory,
      cpus: String(app.cpus),
      readOnly: app.readOnly,
      database: app.database,
      protected: app.protected ?? false,
      env: envToText(app.env),
      takeOver: false,
    },
    tags: await dockerHubTags(app.image),
  }
}

export const actions: Actions = {
  default: async ({ request, params }) => {
    const { appsDomain } = await getSettings()
    const { values, errors, input } = parseAppForm(await request.formData(), {
      withName: false,
      domainRequired: !appsDomain,
    })
    values.name = params.name
    if (!input) return fail(400, { values, errors, deployError: null, output: null })
    const result = await deployApp(params.name, input, { takeOver: values.takeOver })
    if (!result.ok)
      return fail(502, { values, errors, deployError: result.error, output: result.output ?? null })
    // A new domain or sign-in setting changes the app's probe targets and module.
    await writeProbes(await listApps()).catch(() => {})
    redirect(303, `/apps/${params.name}`)
  },
}
