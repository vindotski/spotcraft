import { error, fail } from '@sveltejs/kit'
import { deleteUser, getApp, listUsers } from '#lib/server/agent.ts'
import type { Actions, PageServerLoad } from './$types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const load: PageServerLoad = async ({ params, url }) => {
  const app = await getApp(params.name)
  if (!app) error(404, 'No such app')
  if (!app.database) return { app, page: null }
  const cursor = url.searchParams.get('cursor') ?? undefined
  return { app, page: await listUsers(app.name, cursor), cursor }
}

export const actions: Actions = {
  delete: async ({ params, request }) => {
    const id = String((await request.formData()).get('id') ?? '')
    if (!UUID.test(id)) return fail(400, { deleteError: 'Not a user id.' })
    const deleted = await deleteUser(params.name, id)
    if (!deleted) return fail(404, { deleteError: 'That user no longer exists.' })
    return { deleted: id }
  },
}
