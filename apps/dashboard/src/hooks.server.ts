import { redirect } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { hasValidSession } from '#lib/server/session.ts'
import { SESSION_SECRET } from '$app/env/private'

const PUBLIC_PATHS = new Set(['/login'])

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.authed = hasValidSession(event.cookies, SESSION_SECRET)

  if (!event.locals.authed && !PUBLIC_PATHS.has(event.url.pathname)) {
    if (event.url.pathname.startsWith('/api/')) {
      return new Response('Unauthorized', { status: 401 })
    }
    redirect(303, '/login')
  }

  const response = await resolve(event)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Nothing here should be cached by browsers or proxies: it's all behind a login.
  response.headers.set('Cache-Control', 'no-store')
  return response
}
