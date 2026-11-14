import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clientAddress, GuestLimitError, isGuestLimitError, network } from '../src/index.ts'

const via = (forwardedFor?: string) =>
  new Request('http://localhost/', {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  })

describe('clientAddress', () => {
  it('trusts the address the proxy added (the last one)', () => {
    assert.equal(clientAddress(via('203.0.113.7'), '172.18.0.2'), '203.0.113.7')
    assert.equal(clientAddress(via('6.6.6.6, 203.0.113.7'), '172.18.0.2'), '203.0.113.7')
    assert.equal(clientAddress(via('6.6.6.6,  2001:db8::1 ')), '2001:db8:0:0::/64')
  })

  it('uses the connection without a proxy', () => {
    assert.equal(clientAddress(via(), '127.0.0.1'), '127.0.0.1')
    assert.equal(clientAddress(via(''), '127.0.0.1'), '127.0.0.1')
    assert.equal(clientAddress(via(), '::1'), '0:0:0:0::/64')
  })

  it('still answers without either', () => {
    assert.equal(clientAddress(via()), 'unknown')
  })
})

describe('network', () => {
  it('cuts an IPv6 address to its /64, so every address in it counts as one', () => {
    const home = '2001:db8:abcd:12::/64'
    assert.equal(network('2001:db8:abcd:12::1'), home)
    assert.equal(network('2001:0db8:ABCD:0012:1234:5678:9abc:def0'), home)
    assert.equal(network('2001:db8:abcd:12:ffff:ffff:ffff:ffff'), home)
    assert.notEqual(network('2001:db8:abcd:13::1'), home)
  })

  it('expands :: wherever it is', () => {
    assert.equal(network('::'), '0:0:0:0::/64')
    assert.equal(network('2001:db8::'), '2001:db8:0:0::/64')
    assert.equal(network('::1:2:3:4:5'), '0:0:0:1::/64')
    assert.equal(network('fe80::1%eth0'), 'fe80:0:0:0::/64')
  })

  it('keeps IPv4 addresses whole, mapped into IPv6 or not', () => {
    assert.equal(network('203.0.113.7'), '203.0.113.7')
    assert.equal(network('::ffff:203.0.113.7'), '203.0.113.7')
    assert.equal(network('::FFFF:203.0.113.7'), '203.0.113.7')
  })

  it('leaves what it cannot read as it is', () => {
    for (const odd of ['unknown', '1::2::3', 'zz::1', '1:2:3:4:5:6:7:8:9', '1:2:3', '12345::1']) {
      assert.equal(network(odd), odd)
    }
  })
})

describe('isGuestLimitError', () => {
  it("recognises the kit's guest limit", () => {
    const error: unknown = new GuestLimitError(120)
    assert.ok(isGuestLimitError(error))
    assert.equal(error.retryAfterSeconds, 120)
  })

  it('recognises it from another copy of the kit (a separate bundle)', () => {
    class GuestLimitError extends Error {
      status = 429
      retryAfterSeconds = 60
    }
    assert.ok(isGuestLimitError(new GuestLimitError()))
  })

  it('ignores every other error', () => {
    assert.equal(isGuestLimitError(new Error('connect ECONNREFUSED')), false)
    assert.equal(isGuestLimitError(Object.assign(new Error('x'), { status: 409 })), false)
    assert.equal(isGuestLimitError({ status: 429, retryAfterSeconds: 5 }), false) // not an Error
    assert.equal(
      isGuestLimitError(Object.assign(new Error('x'), { status: 429, retryAfterSeconds: NaN })),
      false,
    )
  })
})
