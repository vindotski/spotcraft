import { fail, redirect } from '@sveltejs/kit'
import { deployApp, getApp, getSettings, listApps } from '#lib/server/agent.ts'
import { parseAppForm } from '#lib/server/app-form.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { appsDomain, dns, access } = await getSettings()
  return { appsDomain, dns, access }
}

export const actions: Actions = {
  default: async ({ request }) => {
    const { appsDomain } = await getSettings()
    const { values, errors, input } = parseAppForm(await request.formData(), {
      withName: true,
      domainRequired: !appsDomain,
    })
    if (!input) return fail(400, { values, errors, deployError: null, output: null })
    // The agent's PUT also updates; a new app must not silently replace an existing one.
    if (await getApp(values.name)) {
      return fail(400, {
        values,
        errors: { name: `An app called "${values.name}" already exists.` },
        deployError: null,
        output: null,
      })
    }
    const result = await deployApp(values.name, input, { takeOver: values.takeOver })
    if (!result.ok)
      return fail(502, { values, errors, deployError: result.error, output: result.output ?? null })
    await writeProbes(await listApps()).catch(() => {})
    redirect(303, `/apps/${values.name}`)
  },
}
