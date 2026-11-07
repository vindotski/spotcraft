import { fail, redirect } from '@sveltejs/kit'
import { clearFailures, isLockedOut, recordFailure } from '#lib/server/login-limit.ts'
import { verifyPassword } from '#lib/server/password.ts'
import { startSession } from '#lib/server/session.ts'
import { DASHBOARD_PASSWORD_HASH, SESSION_SECRET } from '$app/env/private'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = ({ locals }) => {
  if (locals.authed) redirect(303, '/')
}

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    // Caddy always sends X-Forwarded-For; without it (a direct request) fall back to one shared bucket.
    let address = 'unknown'
    try {
      address = getClientAddress()
    } catch {}
    if (isLockedOut(address)) {
      return fail(429, { error: 'Too many attempts. Try again in 15 minutes.' })
    }
    const password = String((await request.formData()).get('password') ?? '')
    if (!(await verifyPassword(password, DASHBOARD_PASSWORD_HASH))) {
      recordFailure(address)
      return fail(400, { error: 'Wrong password.' })
    }
    clearFailures(address)
    startSession(cookies, SESSION_SECRET)
    redirect(303, '/')
  },
}
