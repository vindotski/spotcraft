import { fail, redirect } from '@sveltejs/kit'
import { deployApp, getApp, listApps } from '#lib/server/agent.ts'
import { parseAppForm } from '#lib/server/app-form.ts'
import { writeProbes } from '#lib/server/probes.ts'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async ({ request }) => {
    const { values, errors, input } = parseAppForm(await request.formData(), { withName: true })
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
    const result = await deployApp(values.name, input)
    if (!result.ok)
      return fail(502, { values, errors, deployError: result.error, output: result.output ?? null })
    await writeProbes(await listApps()).catch(() => {})
    redirect(303, `/apps/${values.name}`)
  },
}
