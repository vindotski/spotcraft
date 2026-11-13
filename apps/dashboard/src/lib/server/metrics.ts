import { NAME } from '@spotcraft/agent/app-spec'
import { VICTORIAMETRICS_URL } from '$app/env/private'

/** A time series as [unix seconds, value] points. */
export type Series = Array<[number, number]>

async function query(path: string, params: Record<string, string>) {
  try {
    const url = new URL(path, VICTORIAMETRICS_URL)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return []
    const body = (await response.json()) as {
      data?: {
        result?: Array<{
          metric: Record<string, string>
          value?: [number, string]
          values?: Array<[number, string]>
        }>
      }
    }
    return body.data?.result ?? []
  } catch {
    // Metrics are best-effort: the dashboard still works when VictoriaMetrics is down.
    return []
  }
}

/** Current value of a single-result query, or null when there's no data. */
export async function instant(promql: string): Promise<number | null> {
  const [first] = await query('/api/v1/query', { query: promql })
  const value = first?.value ? Number(first.value[1]) : Number.NaN
  return Number.isFinite(value) ? value : null
}

/** Current values keyed by one label (e.g. uptime per app). */
export async function instantBy(promql: string, label: string): Promise<Record<string, number>> {
  const result = await query('/api/v1/query', { query: promql })
  return Object.fromEntries(
    result
      .filter((row) => row.value && row.metric[label])
      .map((row) => [row.metric[label], Number(row.value?.[1])]),
  )
}

/** The last `minutes` of a single-result query, one point per `step` seconds. */
export async function range(promql: string, minutes = 60, step = 60): Promise<Series> {
  const end = Math.floor(Date.now() / 1000)
  const [first] = await query('/api/v1/query_range', {
    query: promql,
    start: String(end - minutes * 60),
    end: String(end),
    step: `${step}s`,
  })
  return (first?.values ?? [])
    .map(([t, v]) => [t, Number(v)] as [number, number])
    .filter(([, v]) => Number.isFinite(v))
}

// Only valid app names (lower-case letters, digits, dashes) go into a selector; anything else
// could change the query, so it is refused here whatever the caller checked.
const appName = new RegExp(NAME)
const checked = (name: string) => {
  if (!appName.test(name)) throw new Error(`Not an app name: ${name}`)
  return name
}
const project = (name: string) =>
  `container_label_com_docker_compose_project="spotcraft-app-${checked(name)}"`
const probes = (name: string) => `job="probes",app="${checked(name)}"`

export const promql = {
  appCpu: (name: string) => `sum(rate(container_cpu_usage_seconds_total{${project(name)}}[2m]))`,
  appMemory: (name: string) => `sum(container_memory_working_set_bytes{${project(name)}})`,
  appResponse: (name: string) => `max(probe_duration_seconds{${probes(name)}})`,
  // An app has a probe per host (default host, custom domain): reachable only if every host
  // answers, and its uptime averages them, as the app list does.
  appUp: (name: string) => `min(probe_success{${probes(name)}})`,
  appUptime: (name: string, window: string) =>
    `avg(avg_over_time(probe_success{${probes(name)}}[${window}]))`,
  uptimeByApp: (window: string) =>
    `avg by (app) (avg_over_time(probe_success{job="probes"}[${window}]))`,
  hostCpu: `100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m])))`,
  hostMemory: `100 * (1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))`,
  hostMemoryTotal: `sum(node_memory_MemTotal_bytes)`,
  hostDisk: `100 * (1 - sum(node_filesystem_avail_bytes{mountpoint="/"}) / sum(node_filesystem_size_bytes{mountpoint="/"}))`,
  hostDiskTotal: `sum(node_filesystem_size_bytes{mountpoint="/"})`,
  hostLoad: `max(node_load1)`,
  hostCores: `count(node_cpu_seconds_total{mode="idle"})`,
  hostUptime: `max(node_time_seconds - node_boot_time_seconds)`,
}
