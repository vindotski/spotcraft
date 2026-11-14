import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bearerToken, isHookPath, releaseTag } from '../src/lib/server/hook.ts'

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://dash.example.com/hooks/deploy/blog', { method: 'POST', body, headers })

describe('deploy hook', () => {
  it('is only /hooks/deploy/<name> that skips sign-in', () => {
    assert.equal(isHookPath('/hooks/deploy/blog'), true)
    for (const path of [
      '/',
      '/apps/blog',
      '/api/tags',
      '/hooks/',
      '/hooks/other',
      '/hooks/deploy/',
      '/hooks/deploy/blog/more',
      '/hooksdeploy/blog',
      '/Hooks/deploy/blog',
      '/login',
    ]) {
      assert.equal(isHookPath(path), false, path)
    }
  })

  it('takes a bearer token only in its expected shape', () => {
    const withAuth = (value: string) =>
      new Request('https://x/', { headers: { authorization: value } })
    assert.equal(bearerToken(withAuth('Bearer abc_DEF-123')), 'abc_DEF-123')
    for (const value of ['', 'Bearer ', 'Basic abc', 'Bearer a b']) {
      assert.equal(bearerToken(withAuth(value)), undefined, JSON.stringify(value))
    }
    assert.equal(bearerToken(new Request('https://x/')), undefined)
  })

  it('wants a JSON body with a valid tag', async () => {
    const json = { 'content-type': 'application/json' }
    assert.deepEqual(await releaseTag(post('{"tag":"sha-abc1234"}', json)), { tag: 'sha-abc1234' })
    // A form or plain text, which a browser could send cross-site without a preflight.
    const form = await releaseTag(
      post('tag=1', { 'content-type': 'application/x-www-form-urlencoded' }),
    )
    assert.equal('status' in form && form.status, 415)
    const text = await releaseTag(post('{"tag":"1.0.0"}', { 'content-type': 'text/plain' }))
    assert.equal('status' in text && text.status, 415)
    for (const body of ['nope', '{}', '{"tag":5}', '{"tag":"-bad"}', '{"tag":"a b"}']) {
      const result = await releaseTag(post(body, json))
      assert.equal('status' in result && result.status, 400, body)
    }
  })
})
