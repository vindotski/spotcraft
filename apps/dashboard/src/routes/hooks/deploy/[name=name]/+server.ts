import { json } from '@sveltejs/kit'
import { AgentUnavailable, relayRelease } from '#lib/server/agent.ts'
import { bearerToken, releaseTag } from '#lib/server/hook.ts'
import type { RequestHandler } from './$types'

/*
 * The deploy hook (ADR 0029), for an app's CI: POST {"tag": "sha-abc1234"} starts a release
 * and answers 202 at once; GET says how the last one went (deploying, live or failed). Both
 * need the app's hook token as `Authorization: Bearer <token>`; the agent checks it. These
 * routes skip the dashboard's sign-in (hooks.server.ts).
 */

const unauthorized = () => json({ error: 'Unauthorized' }, { status: 401 })

async function relay(name: string, token: string, tag?: string) {
  try {
    const { status, body } = await relayRelease(name, token, tag)
    return json(body, { status })
  } catch (error) {
    if (error instanceof AgentUnavailable) {
      return json({ error: 'Spotcraft is not available; try again' }, { status: 503 })
    }
    throw error
  }
}

export const POST: RequestHandler = async ({ params, request }) => {
  const token = bearerToken(request)
  if (!token) return unauthorized()
  const release = await releaseTag(request)
  if ('error' in release) return json({ error: release.error }, { status: release.status })
  return relay(params.name, token, release.tag)
}

export const GET: RequestHandler = async ({ params, request }) => {
  const token = bearerToken(request)
  return token ? relay(params.name, token) : unauthorized()
}
