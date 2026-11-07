import { error } from '@sveltejs/kit'
import { allSlugs, renderDoc } from '#lib/docs.ts'
import type { EntryGenerator, PageServerLoad } from './$types'

/** Prerender every docs page, including ADRs nothing links to yet. */
export const entries: EntryGenerator = () => allSlugs().map((slug) => ({ slug }))

export const load: PageServerLoad = ({ params }) => {
  const page = renderDoc(params.slug)
  if (!page) error(404, 'No such page')
  return { page }
}
