export const percent = (value: number | null, digits = 0) =>
  value === null ? '—' : `${value.toFixed(digits)}%`

export function bytes(value: number | null): string {
  if (value === null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024
    unit += 1
  }
  return `${n.toFixed(n >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export const milliseconds = (seconds: number | null) =>
  seconds === null ? '—' : `${Math.round(seconds * 1000)} ms`

/** Uptime ratio (0–1) as a percentage with enough precision to tell 99.9 from 100. */
export const uptime = (ratio: number | null | undefined) =>
  ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(ratio >= 0.999 ? 2 : 1)}%`

export const clock = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
