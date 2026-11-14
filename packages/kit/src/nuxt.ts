import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { clientAddress, isGuestLimitError } from './client.ts'
import type { Backend, Guest } from './index.ts'

export { healthResponse, type PrepareOptions, prepare, startup } from './start.ts'

/*
 * The kit in a Nuxt 4 app (Nitro 2, h3 1). Nothing is imported from Nuxt or h3: the functions
 * take the parts of h3's event they use, so the kit needs neither installed.
 */

/** What the middleware uses of h3's `H3Event`. */
export interface H3EventLike {
  method: string
  path: string
  headers: Headers
  /** Where the guest goes, as `guest` (declare it on h3's `H3EventContext`). */
  context: Record<string, unknown>
  node: {
    req: { socket?: { remoteAddress?: string }; headers: IncomingHttpHeaders }
    res: ServerResponse
  }
}

export interface GuestMiddlewareOptions {
  /** Paths that need no session (default: Nuxt's built files, the favicon, files with a dot). */
  skip?: RegExp
}

const ASSET = /^\/(?:_nuxt\/|__nuxt|favicon)|\.[a-z0-9]+$/i

/**
 * Server middleware that puts the visitor's guest on `event.context.guest` (null until they
 * save something) and sends the session cookie. Reads (GET, HEAD) never create a guest; any other
 * method does. Over the guest limit it answers 429 itself, with Retry-After and a JSON body
 * shaped like Nuxt's errors (`statusCode`, `message`).
 *
 * ```ts
 * // server/middleware/guest.ts
 * export default defineEventHandler(guestMiddleware(backend))
 * ```
 */
export function guestMiddleware(backend: () => Backend, options: GuestMiddlewareOptions = {}) {
  const skip = options.skip ?? ASSET
  return async (event: H3EventLike): Promise<Response | undefined> => {
    if (skip.test(event.path.split('?')[0] ?? '')) return
    // Better Auth reads only the headers; the URL is the app's own.
    const request = new Request(new URL(event.path, 'http://localhost'), {
      headers: event.headers,
    })
    const reading = event.method === 'GET' || event.method === 'HEAD'
    let session: { guest: Guest | null; headers: Headers }
    try {
      session = reading
        ? await backend().currentGuest(request)
        : await backend().guest(request, {
            clientAddress: clientAddress(request, event.node.req.socket?.remoteAddress),
          })
    } catch (error) {
      if (!isGuestLimitError(error)) throw error
      // Answered here rather than thrown: h3 would log a thrown error as unhandled.
      return Response.json(
        { statusCode: 429, statusMessage: 'Too Many Requests', message: error.message },
        { status: 429, headers: { 'retry-after': String(error.retryAfterSeconds) } },
      )
    }
    event.context.guest = session.guest
    for (const cookie of session.headers.getSetCookie()) {
      event.node.res.appendHeader('set-cookie', cookie)
    }
    return undefined
  }
}
