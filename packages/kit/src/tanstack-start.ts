import {
  appendResponseHeader,
  getRequest,
  getRequestIP,
  setResponseHeader,
} from '@tanstack/react-start/server'
import { clientAddress, isGuestLimitError } from './client.ts'
import type { Backend } from './index.ts'

export { healthResponse, type PrepareOptions, prepare, startup } from './start.ts'

/*
 * The kit in a TanStack Start app (React, on Nitro 3). The helpers read the request from
 * Start's request scope, so they work in server functions, server routes and middleware.
 */

/** Sends the kit's cookie with the response, and keeps the answer out of every cache. */
function sendCookies(headers: Headers) {
  for (const cookie of headers.getSetCookie()) appendResponseHeader('set-cookie', cookie)
  // The answer depends on who asks.
  setResponseHeader('cache-control', 'private, no-store')
}

/**
 * The visitor's guest id, for server code:
 * - `currentGuestId()` reads it, null if they have never saved anything;
 * - `guestId()` creates the guest (and its cookie) on their first save.
 *
 * Over the guest limit, `guestId()` sets Retry-After and throws the kit's `GuestLimitError`,
 * which Start answers with its status, 429. Catch it with `isGuestLimitError` to say more.
 */
export function guestHelpers(backend: () => Backend) {
  return {
    async currentGuestId(): Promise<string | null> {
      const { guest, headers } = await backend().currentGuest(getRequest())
      sendCookies(headers)
      return guest?.id ?? null
    },
    async guestId(): Promise<string> {
      const request = getRequest()
      try {
        const { guest, headers } = await backend().guest(request, {
          clientAddress: clientAddress(request, getRequestIP()),
        })
        sendCookies(headers)
        return guest.id
      } catch (error) {
        if (isGuestLimitError(error))
          setResponseHeader('retry-after', String(error.retryAfterSeconds))
        throw error
      }
    },
  }
}
