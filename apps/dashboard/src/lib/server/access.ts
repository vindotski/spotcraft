import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from 'jose'

/** Cloudflare Access in front of the dashboard (ADR 0023). */
export interface AccessConfig {
  /** The Zero Trust team domain, e.g. `example.cloudflareaccess.com`. */
  teamDomain: string
  /** The dashboard's Access application audience tag (AUD). */
  audience: string
}

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/
const AUDIENCE = /^[0-9a-f]{64}$/

/**
 * Reads `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`: both set turns Access sign-in on, neither
 * leaves it off, and anything else is a configuration error.
 */
export function accessConfig(
  teamDomain: string | undefined,
  audience: string | undefined,
): AccessConfig | undefined {
  if (!teamDomain && !audience) return undefined
  if (!teamDomain || !audience) {
    throw new Error('Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither')
  }
  if (!TEAM_DOMAIN.test(teamDomain)) {
    throw new Error('CF_ACCESS_TEAM_DOMAIN must look like <team>.cloudflareaccess.com')
  }
  if (!AUDIENCE.test(audience)) {
    throw new Error("CF_ACCESS_AUD must be the Access application's 64-character AUD tag")
  }
  return { teamDomain, audience }
}

/** Header Cloudflare Access adds to every request it lets through. */
export const ACCESS_HEADER = 'cf-access-jwt-assertion'

/**
 * Returns a function that checks the request's Access token and gives the signed-in email, or
 * undefined. Only the header counts, never the `CF_Authorization` cookie: Cloudflare sets the
 * header on the requests it forwards. The audience check is what keeps out tokens Access issues
 * for other applications, such as protected hosted apps.
 */
export function accessVerifier(
  { teamDomain, audience }: AccessConfig,
  /** The signing keys; Cloudflare's published ones unless a test passes its own. */
  keys?: JWTVerifyGetKey,
  log: (message: string) => void = console.error,
): (request: Request) => Promise<string | undefined> {
  const issuer = `https://${teamDomain}`
  // jose caches the keys and fetches them again when Cloudflare rotates them.
  const getKey = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  return async (request) => {
    const token = request.headers.get(ACCESS_HEADER)
    if (!token) return undefined
    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer,
        audience,
        algorithms: ['RS256'],
      })
      return typeof payload.email === 'string' && payload.email ? payload.email : undefined
    } catch (error) {
      // A bad or expired token is normal; not reaching the keys means everyone falls back to
      // the password, so say so.
      const invalidToken =
        error instanceof errors.JOSEError &&
        !(error instanceof errors.JWKSTimeout) &&
        !(error instanceof errors.JWKSInvalid)
      if (!invalidToken) log(`Cloudflare Access: can't check sign-in tokens: ${String(error)}`)
      return undefined
    }
  }
}
