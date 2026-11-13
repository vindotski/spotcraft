import { redirect } from '@sveltejs/kit'
import { accessLogoutUrl } from '#lib/server/access.ts'
import { endSession } from '#lib/server/session.ts'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = ({ cookies, locals, url }) => {
  endSession(cookies)
  // Signed in through Cloudflare Access: end that sign-in too, or the next request is let
  // straight back in. Cloudflare answers this path itself on the dashboard's host, then
  // returns to the dashboard, where Access asks for the sign-in again.
  redirect(303, locals.accessEmail ? accessLogoutUrl(url.host) : '/login')
}
