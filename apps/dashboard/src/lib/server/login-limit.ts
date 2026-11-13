import { isIPv6 } from 'node:net'

// Failed logins per client: 5 within 15 minutes locks that client out until the window ends.
// An IPv6 client counts by its /64, the block one household or server usually gets, so cycling
// through its addresses doesn't buy more tries.
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
// Bounds the table when many addresses fail once: the oldest entries go first.
const MAX_ENTRIES = 10_000
const failures = new Map<string, { count: number; resetAt: number }>()

/** The key a client's failures count under: its IPv4 address, or its IPv6 /64. */
export function clientKey(address: string): string {
  const plain = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
  if (!isIPv6(plain)) return plain
  // Expand `::` so the first four groups are always there.
  const [head, tail = ''] = plain.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':')}::/64`
}

function sweep(now: number) {
  for (const [key, entry] of failures) if (entry.resetAt < now) failures.delete(key)
  // Map keeps insertion order: drop the oldest until there's room.
  for (const key of failures.keys()) {
    if (failures.size < MAX_ENTRIES) break
    failures.delete(key)
  }
}

export function isLockedOut(address: string): boolean {
  const key = clientKey(address)
  const entry = failures.get(key)
  if (!entry) return false
  if (entry.resetAt < Date.now()) {
    failures.delete(key)
    return false
  }
  return entry.count >= MAX_FAILURES
}

export function recordFailure(address: string) {
  const now = Date.now()
  const key = clientKey(address)
  const entry = failures.get(key)
  if (entry && entry.resetAt >= now) {
    entry.count += 1
    return
  }
  if (failures.size >= MAX_ENTRIES) sweep(now)
  failures.set(key, { count: 1, resetAt: now + WINDOW_MS })
}

export function clearFailures(address: string) {
  failures.delete(clientKey(address))
}
