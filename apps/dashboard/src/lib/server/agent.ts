import type { AgentSettings, AppBody, AppSpec, DomainStatus } from '@spotcraft/agent/app-spec'
import type { AppStatus, ReleaseState, UserPage } from '@spotcraft/agent/apps'
import { AGENT_TOKEN, AGENT_URL } from '$app/env/private'

export type { AgentSettings, AppSpec, AppStatus, DomainStatus, ReleaseState, UserPage }
export type AppInput = AppBody

export class AgentUnavailable extends Error {}

/** A failed deploy: the agent's message plus the command output it captured. */
export interface DeployFailure {
  error: string
  output?: string
}

/**
 * The agent's path for an app. Names are already checked (route matcher, form); encoding keeps any
 * `?` or `#` from ever becoming part of the URL's query or fragment.
 */
const appPath = (name: string) => `/apps/${encodeURIComponent(name)}`

async function call(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  try {
    return await fetch(new URL(path, AGENT_URL), {
      ...init,
      headers: { authorization: `Bearer ${AGENT_TOKEN}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    throw new AgentUnavailable(`The agent at ${AGENT_URL} did not answer`, { cause })
  }
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Agent answered ${response.status}`)
  }
  return response.json() as Promise<T>
}

/** What apps are served under: the apps domain (if any) and whether Cloudflare is in front. */
export async function getSettings(): Promise<AgentSettings> {
  return expectJson<AgentSettings>(await call('/settings'))
}

export async function listApps(): Promise<AppStatus[]> {
  return (await expectJson<{ apps: AppStatus[] }>(await call('/apps'))).apps
}

export async function getApp(name: string): Promise<AppStatus | undefined> {
  const response = await call(appPath(name))
  if (response.status === 404) return undefined
  return expectJson<AppStatus>(response)
}

/** Deploys can take minutes (image pull + health wait), so the timeout is generous. */
export async function deployApp(
  name: string,
  input: AppInput,
): Promise<{ ok: true; app: AppStatus } | ({ ok: false } & DeployFailure)> {
  const response = await call(
    appPath(name),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    300_000,
  )
  if (response.ok) return { ok: true, app: (await response.json()) as AppStatus }
  const body = (await response.json().catch(() => ({}))) as DeployFailure
  return {
    ok: false,
    error: body.error ?? `Agent answered ${response.status}`,
    output: body.output,
  }
}

/** Removes the app; with `purge`, also deletes its database. Throws with the agent's message. */
export async function removeApp(name: string, { purge = false } = {}): Promise<void> {
  const query = purge ? '?purge=true' : ''
  const response = await call(`${appPath(name)}${query}`, { method: 'DELETE' }, 120_000)
  if (!response.ok && response.status !== 404) await expectJson(response)
}

/** A page of the app's users, newest first; `cursor` is the previous page's `next`. */
export async function listUsers(name: string, cursor?: string): Promise<UserPage> {
  const query = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) })
  return expectJson<UserPage>(await call(`${appPath(name)}/users?${query}`))
}

/** Deletes a user and, through its foreign keys, what the app kept for them. */
export async function deleteUser(name: string, id: string): Promise<boolean> {
  const response = await call(`${appPath(name)}/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (response.status === 404) return false
  if (!response.ok) await expectJson(response) // throws with the agent's message
  return true
}

/** Where the app's custom domain stands; undefined if the agent can't say. */
export async function getDomainStatus(name: string): Promise<DomainStatus | undefined> {
  const response = await call(`${appPath(name)}/domain`, {}, 30_000)
  if (!response.ok) return undefined
  return (await response.json()) as DomainStatus
}

export async function appLogs(name: string, tail = 200): Promise<string> {
  const response = await call(`${appPath(name)}/logs?tail=${tail}`)
  if (!response.ok) return ''
  return response.text()
}

/** Whether the app has a deploy hook token (ADR 0029); undefined if there is no such app. */
export async function hookEnabled(name: string): Promise<boolean | undefined> {
  const response = await call(`${appPath(name)}/hook-token`)
  if (response.status === 404) return undefined
  return (await expectJson<{ enabled: boolean }>(response)).enabled
}

/** A new deploy hook token for the app, replacing any old one. Shown once; only its hash is kept. */
export async function createHookToken(name: string): Promise<string> {
  const response = await call(`${appPath(name)}/hook-token`, { method: 'POST' })
  return (await expectJson<{ token: string }>(response)).token
}

/** Turns the app's deploy hook off. */
export async function deleteHookToken(name: string): Promise<void> {
  const response = await call(`${appPath(name)}/hook-token`, { method: 'DELETE' })
  if (!response.ok) await expectJson(response)
}

/**
 * Relays a call to the deploy hook from the app's CI: a new release (`tag`) or, without one,
 * how the last release went. The agent checks the hook token; its answer is passed through.
 */
export async function relayRelease(
  name: string,
  hookToken: string,
  tag?: string,
): Promise<{ status: number; body: ReleaseState | { error: string } }> {
  const response = await call(
    `${appPath(name)}/release`,
    tag === undefined
      ? { headers: { 'x-hook-token': hookToken } }
      : {
          method: 'POST',
          headers: { 'x-hook-token': hookToken, 'content-type': 'application/json' },
          body: JSON.stringify({ tag }),
        },
  )
  const body = (await response.json().catch(() => ({ error: 'Agent answered without JSON' }))) as
    | ReleaseState
    | { error: string }
  return { status: response.status, body }
}
