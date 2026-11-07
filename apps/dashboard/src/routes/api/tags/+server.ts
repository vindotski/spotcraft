import { IMAGE } from '@spotcraft/agent/app-spec'
import { json } from '@sveltejs/kit'
import { dockerHubTags } from '#lib/server/dockerhub.ts'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const image = (url.searchParams.get('image') ?? '').toLowerCase()
  if (!new RegExp(IMAGE).test(image)) return json([])
  return json(await dockerHubTags(image))
}
