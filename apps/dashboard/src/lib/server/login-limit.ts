// Failed logins per client address: 5 within 15 minutes locks that address out until the window ends.
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const failures = new Map<string, { count: number; resetAt: number }>()

export function isLockedOut(address: string): boolean {
  const entry = failures.get(address)
  if (!entry) return false
  if (entry.resetAt < Date.now()) {
    failures.delete(address)
    return false
  }
  return entry.count >= MAX_FAILURES
}

export function recordFailure(address: string) {
  const now = Date.now()
  const entry = failures.get(address)
  if (!entry || entry.resetAt < now) failures.set(address, { count: 1, resetAt: now + WINDOW_MS })
  else entry.count += 1
}

export function clearFailures(address: string) {
  failures.delete(address)
}
