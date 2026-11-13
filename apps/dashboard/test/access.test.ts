import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { accessConfig, accessVerifier } from '../src/lib/server/access.ts'

const teamDomain = 'example.cloudflareaccess.com'
const audience = 'a'.repeat(64)
const issuer = `https://${teamDomain}`

describe('Cloudflare Access sign-in (ADR 0023)', () => {
  let sign: (
    claims: Record<string, unknown>,
    options?: { kid?: string; exp?: string; wrongKey?: boolean },
  ) => Promise<string>
  let verify: (request: Request) => Promise<string | undefined>
  const logged: string[] = []

  before(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const other = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
    const keys = createLocalJWKSet({ keys: [jwk] })
    sign = (claims, { kid = 'k1', exp = '5m', wrongKey = false } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(wrongKey ? other.privateKey : privateKey)
    verify = accessVerifier({ teamDomain, audience }, keys, (m) => logged.push(m))
  })

  const request = (token?: string) =>
    new Request('https://dash.example.com/', {
      headers: token ? { 'cf-access-jwt-assertion': token } : {},
    })
  const valid = { iss: issuer, aud: [audience], email: 'owner@example.com' }

  it('signs in with a valid token for this application', async () => {
    assert.equal(await verify(request(await sign(valid))), 'owner@example.com')
  })

  it('refuses a token Access issued for another application, e.g. a protected app', async () => {
    const token = await sign({ ...valid, aud: ['b'.repeat(64)] })
    assert.equal(await verify(request(token)), undefined)
  })

  it('refuses expired tokens, other issuers, bad signatures and tokens without an email', async () => {
    const tokens = [
      await sign(valid, { exp: '-1m' }),
      await sign({ ...valid, iss: 'https://evil.cloudflareaccess.com' }),
      // Signed with another key under this key's id, and under an id Cloudflare never published.
      await sign(valid, { wrongKey: true }),
      await sign(valid, { kid: 'unknown', wrongKey: true }),
      await sign({ iss: issuer, aud: [audience] }),
    ]
    for (const token of tokens) assert.equal(await verify(request(token)), undefined)
  })

  it('ignores requests without the header, and the CF_Authorization cookie on its own', async () => {
    assert.equal(await verify(request()), undefined)
    const cookieOnly = new Request('https://dash.example.com/', {
      headers: { cookie: `CF_Authorization=${await sign(valid)}` },
    })
    assert.equal(await verify(cookieOnly), undefined)
  })

  it("doesn't log ordinary bad tokens", () => {
    assert.deepEqual(logged, [])
  })

  it("logs when the signing keys can't be fetched or read", async () => {
    // What jose throws: no connection, a non-200 answer (a plain JOSEError), a timeout, a
    // key set that isn't one.
    const failures = [
      new TypeError('fetch failed'),
      new errors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response'),
      new errors.JWKSTimeout(),
      new errors.JWKSInvalid('JSON Web Key Set malformed'),
    ]
    for (const failure of failures) {
      const messages: string[] = []
      const broken = accessVerifier(
        { teamDomain, audience },
        async () => {
          throw failure
        },
        (m) => messages.push(m),
      )
      assert.equal(await broken(request(await sign(valid))), undefined)
      assert.match(messages[0] ?? '', /can't check sign-in tokens/, failure.message)
    }
  })
})

describe('Access settings', () => {
  it('is off when neither variable is set', () => {
    assert.equal(accessConfig(undefined, undefined), undefined)
  })

  it('needs both variables, in the right shape', () => {
    assert.deepEqual(accessConfig(teamDomain, audience), { teamDomain, audience })
    assert.throws(() => accessConfig(teamDomain, undefined), /both/)
    assert.throws(() => accessConfig(undefined, audience), /both/)
    assert.throws(() => accessConfig('example.com', audience), /cloudflareaccess\.com/)
    assert.throws(() => accessConfig(teamDomain, 'not-hex'), /AUD/)
  })
})
