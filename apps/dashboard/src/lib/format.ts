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

/** A date and time in the server's locale, e.g. "8 Nov 2026, 06:12". */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** How long ago, roughly: "just now", "5 min ago", "3 h ago", "12 days ago". */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} days ago`
}
