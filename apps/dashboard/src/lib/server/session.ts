import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Cookies } from '@sveltejs/kit'

export const SESSION_COOKIE = 'spotcraft_session'
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url')

/** Stateless session: `v1.<expires ms>.<hmac>`. Changing SESSION_SECRET ends every session. */
export function startSession(cookies: Cookies, secret: string) {
  const payload = `v1.${Date.now() + MAX_AGE_SECONDS * 1000}`
  cookies.set(SESSION_COOKIE, `${payload}.${sign(secret, payload)}`, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: MAX_AGE_SECONDS,
  })
}

export function endSession(cookies: Cookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' })
}

export function hasValidSession(cookies: Cookies, secret: string): boolean {
  const value = cookies.get(SESSION_COOKIE)
  if (!value) return false
  const lastDot = value.lastIndexOf('.')
  const payload = value.slice(0, lastDot)
  const given = Buffer.from(value.slice(lastDot + 1))
  const expected = Buffer.from(sign(secret, payload))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
  const [version, expires] = payload.split('.')
  return version === 'v1' && Number(expires) > Date.now()
}
