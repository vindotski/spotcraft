import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearFailures,
  clientKey,
  isLockedOut,
  recordFailure,
} from '../src/lib/server/login-limit.ts'
import { isAppName } from '../src/params.ts'

describe('app names in URLs', () => {
  it('matches only names the agent accepts', () => {
    assert.equal(isAppName('blog'), true)
    // SvelteKit decodes %3F and %23 in params: these must never reach an agent URL.
    for (const crafted of ['blog?purge=true', 'blog#/users', '../agent', 'Blog', 'b']) {
      assert.equal(isAppName(crafted), false, crafted)
    }
  })
})

describe('login lockout', () => {
  it('counts IPv6 clients by their /64', () => {
    assert.equal(clientKey('2001:db8:1:2::5'), '2001:db8:1:2::/64')
    assert.equal(clientKey('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64')
    assert.equal(clientKey('::ffff:203.0.113.9'), '203.0.113.9')
    assert.equal(clientKey('203.0.113.9'), '203.0.113.9')
  })

  it('locks out a /64 after 5 failures, whichever addresses they came from', () => {
    for (let i = 1; i <= 5; i++) recordFailure(`2001:db8:9:9::${i}`)
    assert.equal(isLockedOut('2001:db8:9:9::abcd'), true)
    assert.equal(isLockedOut('2001:db8:9:a::1'), false, 'the next /64 is not')
    clearFailures('2001:db8:9:9::1')
    assert.equal(isLockedOut('2001:db8:9:9::abcd'), false)
  })
})
