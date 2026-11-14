/*
 * The client address that the guest limit counts, and the limit's error, checked by shape.
 */

/**
 * The visitor's address, from a request that came through Spotcraft's Caddy. Caddy sets
 * X-Forwarded-For to the address it was connected from and drops what the client sent, so its
 * last entry is the one to trust; earlier entries could come from anyone. Without the header
 * (the app reached directly, as in development) it is `fallback`, the connection's own address
 * if the framework gives one, else `'unknown'`.
 *
 * An IPv6 address counts as its /64 (`network`).
 */
export function clientAddress(request: Request, fallback?: string): string {
  const last = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
  return network(last || fallback || 'unknown')
}

const GROUP = /^[0-9a-f]{1,4}$/
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/

/**
 * An IPv6 address's /64 (`2001:db8:0:1::/64`). One home or phone usually gets a whole /64 and
 * may pick any address in it, so a limit per address would be no limit. An IPv4 address, or
 * anything else, comes back as it is.
 */
export function network(address: string): string {
  if (!address.includes(':')) return address
  const plain = (address.split('%')[0] ?? '').toLowerCase() // without a zone (`fe80::1%eth0`)
  // An IPv4 address mapped into IPv6 (`::ffff:203.0.113.7`) is that IPv4 address.
  const ipv4 = MAPPED_IPV4.exec(plain)?.[1]
  if (ipv4) return ipv4
  const halves = plain.split('::')
  if (halves.length > 2) return address
  const [head = '', tail] = halves
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  // `::` stands for one or more zero groups; without it there must be all eight.
  const zeros = 8 - left.length - right.length
  if (tail === undefined ? zeros !== 0 : zeros < 1) return address
  const groups = [...left, ...Array<string>(zeros).fill('0'), ...right]
  if (!groups.every((group) => GROUP.test(group))) return address
  const prefix = groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16))
  return `${prefix.join(':')}::/64`
}

/**
 * Whether `error` is the kit's guest limit (`GuestLimitError`): answer 429 with Retry-After.
 * It checks the shape, not `instanceof`: an app's server is often bundled more than once (the
 * app by Vite, a plugin by Nitro), and an error from one bundle's copy of the kit fails an
 * `instanceof` against another's, which would turn the 429 into a 500.
 */
export function isGuestLimitError(
  error: unknown,
): error is Error & { status: 429; retryAfterSeconds: number } {
  if (!(error instanceof Error) || !('status' in error) || error.status !== 429) return false
  const wait = 'retryAfterSeconds' in error ? error.retryAfterSeconds : undefined
  return typeof wait === 'number' && Number.isFinite(wait)
}
