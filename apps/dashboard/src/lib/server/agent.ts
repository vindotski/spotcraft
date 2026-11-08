import type { AppBody, AppSpec } from '@spotcraft/agent/app-spec'
import type { AppStatus, UserPage } from '@spotcraft/agent/apps'
import { AGENT_TOKEN, AGENT_URL } from '$app/env/private'

export type { AppSpec, AppStatus, UserPage }
export type AppInput = AppBody

export class AgentUnavailable extends Error {}

/** A failed deploy: the agent's message plus the command output it captured. */
export interface DeployFailure {
  error: string
  output?: string
}

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

export async function listApps(): Promise<AppStatus[]> {
  return (await expectJson<{ apps: AppStatus[] }>(await call('/apps'))).apps
}

export async function getApp(name: string): Promise<AppStatus | undefined> {
  const response = await call(`/apps/${name}`)
  if (response.status === 404) return undefined
  return expectJson<AppStatus>(response)
}

/** Deploys can take minutes (image pull + health wait), so the timeout is generous. */
export async function deployApp(
  name: string,
  input: AppInput,
): Promise<{ ok: true; app: AppStatus } | ({ ok: false } & DeployFailure)> {
  const response = await call(
    `/apps/${name}`,
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
  const response = await call(`/apps/${name}${query}`, { method: 'DELETE' }, 120_000)
  if (!response.ok && response.status !== 404) await expectJson(response)
}

/** A page of the app's users, newest first; `cursor` is the previous page's `next`. */
export async function listUsers(name: string, cursor?: string): Promise<UserPage> {
  const query = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) })
  return expectJson<UserPage>(await call(`/apps/${name}/users?${query}`))
}

/** Deletes a user and, through its foreign keys, what the app kept for them. */
export async function deleteUser(name: string, id: string): Promise<boolean> {
  const response = await call(`/apps/${name}/users/${id}`, { method: 'DELETE' })
  if (response.status === 404) return false
  if (!response.ok) await expectJson(response) // throws with the agent's message
  return true
}

export async function appLogs(name: string, tail = 200): Promise<string> {
  const response = await call(`/apps/${name}/logs?tail=${tail}`)
  if (!response.ok) return ''
  return response.text()
}
