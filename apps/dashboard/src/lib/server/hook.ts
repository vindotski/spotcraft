import { TAG } from '@spotcraft/agent/app-spec'

/*
 * The deploy hook's checks (ADR 0029), kept apart from the route so they can be tested.
 */

/**
 * Whether a path is the deploy hook, `/hooks/deploy/<name>`, which an app's CI calls with no
 * session or Access sign-in. Each request carries that app's hook token, which the agent checks.
 * Exactly this path: a route added under /hooks later still needs a sign-in.
 */
export const isHookPath = (pathname: string) => /^\/hooks\/deploy\/[^/]+$/.test(pathname)

/** The token in `Authorization: Bearer <token>`, if it has a token's shape. */
export const bearerToken = (request: Request) =>
  /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(request.headers.get('authorization') ?? '')?.[1]

/**
 * The tag a release asks for, or why the request can't be one. JSON only: a browser can't send
 * it cross-site without a preflight.
 */
export async function releaseTag(
  request: Request,
): Promise<{ tag: string } | { status: 400 | 415; error: string }> {
  const usage = 'Send JSON: {"tag": "<image tag>"}'
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return { status: 415, error: usage }
  }
  const body = (await request.json().catch(() => null)) as { tag?: unknown } | null
  const tag = body?.tag
  if (typeof tag !== 'string' || !new RegExp(TAG).test(tag)) return { status: 400, error: usage }
  return { tag }
}
