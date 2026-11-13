import { redirect } from '@sveltejs/kit'
import { endSession } from '#lib/server/session.ts'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = ({ cookies, locals }) => {
  endSession(cookies)
  // Signed in through Cloudflare Access: end that sign-in too, or the next request is let
  // straight back in. Cloudflare answers this path itself on the dashboard's host.
  redirect(303, locals.accessEmail ? '/cdn-cgi/access/logout' : '/login')
}
