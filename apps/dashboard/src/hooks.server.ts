import { redirect } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit/hooks'
import { accessConfig, accessVerifier } from '#lib/server/access.ts'
import { hasValidSession } from '#lib/server/session.ts'
import { building } from '$app/env'
import { CF_ACCESS_AUD, CF_ACCESS_TEAM_DOMAIN, SESSION_SECRET } from '$app/env/private'

const PUBLIC_PATHS = new Set(['/login'])

// Behind Cloudflare Access, its sign-in is enough; the password stays as the way in when Access
// isn't in front (ADR 0023).
const access = building
  ? undefined
  : accessConfig(CF_ACCESS_TEAM_DOMAIN || undefined, CF_ACCESS_AUD || undefined)
const verifyAccess = access ? accessVerifier(access) : undefined

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.accessEmail = await verifyAccess?.(event.request)
  event.locals.authed =
    Boolean(event.locals.accessEmail) || hasValidSession(event.cookies, SESSION_SECRET)

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
