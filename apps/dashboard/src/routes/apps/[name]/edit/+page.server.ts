import { error, fail, redirect } from '@sveltejs/kit'
import { deployApp, getApp } from '#lib/server/agent.ts'
import { envToText, parseAppForm } from '#lib/server/app-form.ts'
import { dockerHubTags } from '#lib/server/dockerhub.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const app = await getApp(params.name)
  if (!app) error(404, 'No such app')
  return {
    values: {
      name: app.name,
      image: app.image,
      tag: app.tag,
      domain: app.domain,
      port: String(app.port),
      memory: app.memory,
      cpus: String(app.cpus),
      readOnly: app.readOnly,
      env: envToText(app.env),
    },
    tags: await dockerHubTags(app.image),
  }
}

export const actions: Actions = {
  default: async ({ request, params }) => {
    const { values, errors, input } = parseAppForm(await request.formData(), { withName: false })
    values.name = params.name
    if (!input) return fail(400, { values, errors, deployError: null, output: null })
    const result = await deployApp(params.name, input)
    if (!result.ok)
      return fail(502, { values, errors, deployError: result.error, output: result.output ?? null })
    redirect(303, `/apps/${params.name}`)
  },
}
