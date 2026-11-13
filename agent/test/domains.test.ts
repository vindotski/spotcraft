import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { AccessApps } from '../src/access.ts'
import { buildApp } from '../src/app.ts'
import { Apps } from '../src/apps.ts'
import {
  type AccessApp,
  CloudflareApi,
  type CustomHostname,
  type DnsRecord,
} from '../src/cloudflare.ts'
import { loadConfig } from '../src/config.ts'
import { Domains } from '../src/domains.ts'
import type { Runner } from '../src/runner.ts'
import { Store } from '../src/store.ts'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const auth = { authorization: `Bearer ${TOKEN}` }
const ACCOUNT = 'a'.repeat(32)
const APPS_ZONE = 'z'.repeat(32)
const TUNNEL = '11111111-2222-3333-4444-555555555555'
const TARGET = `${TUNNEL}.cfargotunnel.com`
const spec = { image: 'vindotski/tagtape', tag: '2.0.0' }

/** An in-memory Cloudflare API: zones in the account, their DNS records, custom hostnames. */
function fakeCloudflare(zoneNames: string[]) {
  const zones = zoneNames.map((name, i) => ({ id: `zone${i}`, name }))
  const records = new Map<string, DnsRecord & { zoneId: string }>()
  const customs = new Map<string, CustomHostname>()
  const accessApps = new Map<string, AccessApp & { policies: { id: string }[] }>()
  const calls: string[] = []
  let nextId = 1
  let down = false
  // Fails the first call matching this, then behaves again.
  let failOnce: ((method: string, path: string) => boolean) | undefined
  const ok = (result: unknown) =>
    new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 })

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace('/client/v4', '')
    calls.push(`${method} ${path}`)
    if (down || failOnce?.(method, path)) {
      failOnce = undefined
      return new Response(JSON.stringify({ success: false, errors: [{ message: 'nope' }] }))
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (path === '/zones') {
      assert.equal(url.searchParams.get('account.id'), ACCOUNT)
      return ok(zones.filter((z) => z.name === url.searchParams.get('name')))
    }
    let match = /^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/.exec(path)
    if (match) {
      const [, zoneId, id] = match
      if (method === 'GET') {
        const name = url.searchParams.get('name.exact')
        return ok([...records.values()].filter((r) => r.zoneId === zoneId && r.name === name))
      }
      if (method === 'POST') {
        const record = { ...body, id: `r${nextId++}`, zoneId }
        records.set(record.id, record)
        return ok(record)
      }
      if (method === 'PATCH') {
        const record = { ...records.get(id as string), ...body }
        records.set(id as string, record)
        return ok(record)
      }
      records.delete(id as string)
      return ok({ id })
    }
    match = /^\/zones\/([^/]+)\/custom_hostnames(?:\/([^/]+))?$/.exec(path)
    if (match) {
      assert.equal(match[1], APPS_ZONE)
      const id = match[2]
      if (method === 'GET') {
        return ok(
          [...customs.values()].filter((c) => c.hostname === url.searchParams.get('hostname')),
        )
      }
      if (method === 'POST') {
        const custom: CustomHostname = {
          id: `c${nextId++}`,
          hostname: body.hostname,
          status: 'pending',
          ssl: { status: 'pending_validation' },
          ownership_verification: {
            type: 'txt',
            name: `_cf-custom-hostname.${body.hostname}`,
            value: 'proof',
          },
        }
        customs.set(custom.id, custom)
        return ok(custom)
      }
      customs.delete(id as string)
      return ok({ id })
    }
    match = /^\/accounts\/([^/]+)\/access\/apps(?:\/([^/]+))?$/.exec(path)
    if (match) {
      assert.equal(match[1], ACCOUNT)
      const id = match[2]
      if (method === 'GET') {
        return ok([...accessApps.values()].filter((a) => a.name === url.searchParams.get('name')))
      }
      if (method === 'DELETE') {
        accessApps.delete(id as string)
        return ok({ id })
      }
      const accessApp = { ...body, id: id ?? `a${nextId++}` }
      accessApps.set(accessApp.id, accessApp)
      return ok(accessApp)
    }
    throw new Error(`unexpected ${method} ${path}`)
  }) as typeof fetch

  const add = (zoneName: string, record: Omit<DnsRecord, 'id'>) => {
    const zoneId = zones.find((z) => z.name === zoneName)?.id as string
    const full = { ...record, id: `r${nextId++}`, zoneId }
    records.set(full.id, full)
    return full
  }
  const at = (name: string) => [...records.values()].filter((r) => r.name === name)
  return {
    fetchImpl,
    records,
    customs,
    accessApps,
    calls,
    add,
    at,
    fail: () => (down = true),
    failOnceOn: (match: (method: string, path: string) => boolean) => (failOnce = match),
  }
}

let failUp = false
const run: Runner = async (_file, args) =>
  failUp && args.includes('--wait')
    ? { code: 1, stdout: '', stderr: 'unhealthy' }
    : { code: 0, stdout: '', stderr: '' }

describe('custom domains through Cloudflare (ADR 0021)', () => {
  let dir: string
  let cf: ReturnType<typeof fakeCloudflare>
  let app: ReturnType<typeof buildApp>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-cf-'))
    cf = fakeCloudflare(['spotcraft.dev', 'tagtape.app'])
    const domains = new Domains({
      api: new CloudflareApi('cf-token', ACCOUNT, cf.fetchImpl),
      appsZoneId: APPS_ZONE,
      tunnelId: TUNNEL,
    })
    const settings = { appsDomain: 'spotcraft.dev', edge: 'cloudflare' as const }
    app = buildApp({
      token: TOKEN,
      apps: new Apps(new Store(dir), run, 'caddy', undefined, settings, { domains }),
    })
    failUp = false
  })
  afterEach(async () => {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  })

  const put = (name: string, payload: object, query = '') =>
    app.inject({ method: 'PUT', url: `/apps/${name}${query}`, headers: auth, payload })
  const status = async (name: string) =>
    (await app.inject({ url: `/apps/${name}/domain`, headers: auth })).json()

  it('points a domain in the account at the tunnel, with www. for a root', async () => {
    const res = await put('tagtape', { ...spec, domain: 'tagtape.app' })
    assert.equal(res.statusCode, 200, res.body)
    for (const host of ['tagtape.app', 'www.tagtape.app']) {
      const [record] = cf.at(host)
      assert.equal(record?.type, 'CNAME')
      assert.equal(record?.content, TARGET)
      assert.equal(record?.proxied, true)
      assert.equal(record?.comment, 'spotcraft:tagtape')
    }
    const domain = await status('tagtape')
    assert.equal(domain.target, 'tagtape.spotcraft.dev')
    assert.deepEqual(
      domain.hosts.map((h: { host: string; mode: string; state: string }) => [
        h.host,
        h.mode,
        h.state,
      ]),
      [
        ['tagtape.app', 'zone', 'active'],
        ['www.tagtape.app', 'zone', 'active'],
      ],
    )
    const settings = await app.inject({ url: '/settings', headers: auth })
    assert.equal(settings.json().dns, true)
  })

  it('redeploying changes nothing at Cloudflare', async () => {
    await put('tagtape', { ...spec, domain: 'tagtape.app' })
    const before = cf.calls.length
    await put('tagtape', { ...spec, domain: 'tagtape.app' })
    const writes = cf.calls.slice(before).filter((c) => !c.startsWith('GET'))
    assert.deepEqual(writes, [])
  })

  it("refuses records it didn't make, and replaces them when taking over", async () => {
    cf.add('tagtape.app', {
      type: 'A',
      name: 'tagtape.app',
      content: '203.0.113.7',
      proxied: false,
    })
    cf.add('tagtape.app', { type: 'MX', name: 'tagtape.app', content: 'mail.example.com' })
    const refused = await put('tagtape', { ...spec, domain: 'tagtape.app' })
    assert.equal(refused.statusCode, 409)
    assert.match(
      refused.json().error,
      /already has a record Spotcraft didn't make \(A 203\.0\.113\.7\)/,
    )
    assert.equal(cf.at('www.tagtape.app').length, 0, 'nothing changed, www. included')

    const taken = await put('tagtape', { ...spec, domain: 'tagtape.app' }, '?takeOver=true')
    assert.equal(taken.statusCode, 200, taken.body)
    const types = cf
      .at('tagtape.app')
      .map((r) => r.type)
      .sort()
    assert.deepEqual(types, ['CNAME', 'MX'], 'the A record is replaced; mail stays')
  })

  it('makes a custom hostname for a domain outside the account and says what to add', async () => {
    const res = await put('blog', { ...spec, domain: 'blog.example.org' })
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(
      [...cf.customs.values()].map((c) => c.hostname),
      ['blog.example.org'],
    )
    const [host] = (await status('blog')).hosts
    assert.equal(host.mode, 'saas')
    assert.equal(host.state, 'pending')
    assert.deepEqual(host.records, [
      { type: 'CNAME', name: 'blog.example.org', value: 'blog.spotcraft.dev' },
      { type: 'TXT', name: '_cf-custom-hostname.blog.example.org', value: 'proof' },
    ])
  })

  it('moves records when the domain changes, and removes them with the app', async () => {
    await put('tagtape', { ...spec, domain: 'tagtape.app' })
    await put('tagtape', { ...spec, domain: 'go.tagtape.app' })
    assert.equal(cf.at('tagtape.app').length, 0)
    assert.equal(cf.at('www.tagtape.app').length, 0)
    assert.equal(cf.at('go.tagtape.app').length, 1)

    const removed = await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
    assert.equal(removed.statusCode, 204)
    assert.equal(cf.records.size, 0)
  })

  it('puts taken-over records back when the deploy then fails', async () => {
    cf.add('tagtape.app', {
      type: 'A',
      name: 'tagtape.app',
      content: '203.0.113.7',
      proxied: false,
      ttl: 300,
    })
    cf.add('tagtape.app', {
      type: 'AAAA',
      name: 'www.tagtape.app',
      content: '2001:db8::7',
      proxied: false,
    })
    failUp = true
    const res = await put('tagtape', { ...spec, domain: 'tagtape.app' }, '?takeOver=true')
    assert.equal(res.statusCode, 502)
    const apex = cf.at('tagtape.app')
    assert.deepEqual(
      apex.map((r) => [r.type, r.content, r.proxied, r.ttl]),
      [['A', '203.0.113.7', false, 300]],
      'the old A record is back, with its TTL; no CNAME is left',
    )
    assert.deepEqual(
      cf.at('www.tagtape.app').map((r) => [r.type, r.content]),
      [['AAAA', '2001:db8::7']],
    )
  })

  it('undoes a half-done attach when Cloudflare fails partway', async () => {
    cf.add('tagtape.app', {
      type: 'A',
      name: 'tagtape.app',
      content: '203.0.113.7',
      proxied: false,
    })
    // The apex is switched first; creating the www. record then fails.
    let creates = 0
    cf.failOnceOn(
      (method, path) => method === 'POST' && path.endsWith('/dns_records') && ++creates === 2,
    )
    const res = await put('tagtape', { ...spec, domain: 'tagtape.app' }, '?takeOver=true')
    assert.equal(res.statusCode, 502)
    assert.deepEqual(
      cf.at('tagtape.app').map((r) => [r.type, r.content]),
      [['A', '203.0.113.7']],
    )
    assert.equal(cf.at('www.tagtape.app').length, 0)
  })

  it("refuses a domain that is another app's www. redirect", async () => {
    await put('tagtape', { ...spec, domain: 'tagtape.app' })
    const res = await put('other', { ...spec, domain: 'www.tagtape.app' })
    assert.equal(res.statusCode, 409)
    assert.match(res.json().error, /www\.tagtape\.app is used by tagtape/)
  })

  it('leaves the app untouched when Cloudflare fails', async () => {
    cf.fail()
    const res = await put('tagtape', { ...spec, domain: 'tagtape.app' })
    assert.equal(res.statusCode, 502)
    assert.match(res.json().output, /Cloudflare: nope/)
    assert.equal((await app.inject({ url: '/apps/tagtape', headers: auth })).statusCode, 404)
  })
})

describe('protected apps behind Cloudflare Access (ADR 0021)', () => {
  const POLICY = '99999999-8888-7777-6666-555555555555'
  let dir: string
  let cf: ReturnType<typeof fakeCloudflare>
  let app: ReturnType<typeof buildApp>
  let failUp = false
  const runner: Runner = async (_file, args) =>
    failUp && args.includes('--wait')
      ? { code: 1, stdout: '', stderr: 'unhealthy' }
      : { code: 0, stdout: '', stderr: '' }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-access-'))
    failUp = false
    cf = fakeCloudflare(['spotcraft.dev', 'tagtape.app'])
    const api = new CloudflareApi('cf-token', ACCOUNT, cf.fetchImpl)
    const cloudflare = {
      domains: new Domains({ api, appsZoneId: APPS_ZONE, tunnelId: TUNNEL }),
      access: new AccessApps(api, POLICY),
    }
    const settings = { appsDomain: 'spotcraft.dev', edge: 'cloudflare' as const }
    app = buildApp({
      token: TOKEN,
      apps: new Apps(new Store(dir), runner, 'caddy', undefined, settings, cloudflare),
    })
  })
  afterEach(async () => {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  })

  const put = (name: string, payload: object) =>
    app.inject({ method: 'PUT', url: `/apps/${name}`, headers: auth, payload })
  const accessApps = () => [...cf.accessApps.values()]

  it('covers every host of a protected app with the owners policy', async () => {
    const res = await put('tagtape', { ...spec, domain: 'tagtape.app', protected: true })
    assert.equal(res.statusCode, 200, res.body)
    const [accessApp] = accessApps()
    assert.equal(accessApp?.name, 'spotcraft:tagtape')
    assert.deepEqual(
      accessApp?.destinations?.map((d) => d.uri),
      ['tagtape.spotcraft.dev', 'tagtape.app', 'www.tagtape.app'],
    )
    assert.deepEqual(accessApp?.policies, [{ id: POLICY, precedence: 1 }])
    assert.equal((await app.inject({ url: '/settings', headers: auth })).json().access, true)
  })

  it('keeps protection when an update leaves it out, and removes it when turned off', async () => {
    await put('tagtape', { ...spec, protected: true })
    await put('tagtape', spec)
    assert.equal(accessApps().length, 1)
    const stored = await app.inject({ url: '/apps/tagtape', headers: auth })
    assert.equal(stored.json().protected, true)
    await put('tagtape', { ...spec, protected: false })
    assert.equal(accessApps().length, 0)
  })

  it('removes the Access application with the app', async () => {
    await put('tagtape', { ...spec, protected: true })
    await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
    assert.equal(accessApps().length, 0)
  })

  it('takes protection back when a new app fails to start', async () => {
    failUp = true
    const res = await put('tagtape', { ...spec, protected: true })
    assert.equal(res.statusCode, 502)
    assert.equal(accessApps().length, 0)
  })

  it("protects a protected app's new hosts when the apps domain changes", async () => {
    await put('tagtape', { ...spec, protected: true })
    const api = new CloudflareApi('cf-token', ACCOUNT, cf.fetchImpl)
    const moved = new Apps(
      new Store(dir),
      runner,
      'caddy',
      undefined,
      { appsDomain: 'apps.example.com', edge: 'cloudflare' },
      {
        domains: new Domains({ api, appsZoneId: APPS_ZONE, tunnelId: TUNNEL }),
        access: new AccessApps(api, POLICY),
      },
    )
    assert.deepEqual(await moved.refreshSites(), ['tagtape'])
    assert.deepEqual(
      accessApps()[0]?.destinations?.map((d) => d.uri),
      ['tagtape.apps.example.com'],
    )
  })

  it('keeps the old hosts protected when Caddy rejects the switch', async () => {
    await put('tagtape', { ...spec, protected: true })
    let caddyUp = false
    const flaky: Runner = async (_file, args) =>
      args.includes('reload') && !caddyUp
        ? { code: 1, stdout: '', stderr: 'caddy starting' }
        : { code: 0, stdout: '', stderr: '' }
    const api = new CloudflareApi('cf-token', ACCOUNT, cf.fetchImpl)
    const moved = new Apps(
      new Store(dir),
      flaky,
      'caddy',
      undefined,
      { appsDomain: 'apps.example.com', edge: 'cloudflare' },
      {
        domains: new Domains({ api, appsZoneId: APPS_ZONE, tunnelId: TUNNEL }),
        access: new AccessApps(api, POLICY),
      },
    )
    const hosts = () => accessApps()[0]?.destinations?.map((d) => d.uri)
    await assert.rejects(moved.refreshSites())
    assert.deepEqual(
      hosts(),
      ['tagtape.spotcraft.dev', 'tagtape.apps.example.com'],
      'the old site is back, and still behind Access',
    )
    caddyUp = true
    assert.deepEqual(await moved.refreshSites(), ['tagtape'])
    assert.deepEqual(hosts(), ['tagtape.apps.example.com'], 'narrowed once the new site is live')
  })

  it('refuses protection when the server has no Access policy', async () => {
    const plain = buildApp({
      token: TOKEN,
      apps: new Apps(new Store(dir), runner, 'caddy', undefined, {
        appsDomain: 'spotcraft.dev',
        edge: 'cloudflare',
      }),
    })
    const res = await plain.inject({
      method: 'PUT',
      url: '/apps/tagtape',
      headers: auth,
      payload: { ...spec, protected: true },
    })
    assert.equal(res.statusCode, 409)
    await plain.close()
  })
})

describe('Cloudflare config', () => {
  const base = { AGENT_TOKEN: TOKEN, APPS_DOMAIN: 'spotcraft.dev', EDGE: 'cloudflare' }
  const cf = {
    CLOUDFLARE_API_TOKEN: 't',
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    CLOUDFLARE_APPS_ZONE_ID: APPS_ZONE.replaceAll('z', 'b'),
    CLOUDFLARE_TUNNEL_ID: TUNNEL,
  }
  it('is off without a token and complete with one', () => {
    assert.equal(loadConfig(base).cloudflare, undefined)
    assert.equal(loadConfig({ ...base, ...cf }).cloudflare?.tunnelId, TUNNEL)
    assert.equal(loadConfig({ ...base, ...cf }).cloudflare?.accessPolicyId, undefined)
    const policy = '99999999-8888-7777-6666-555555555555'
    const withAccess = loadConfig({ ...base, ...cf, CLOUDFLARE_ACCESS_POLICY_ID: policy })
    assert.equal(withAccess.cloudflare?.accessPolicyId, policy)
  })
  it('ignores the settings, with a notice, until EDGE=cloudflare and APPS_DOMAIN are set', () => {
    for (const env of [
      { ...base, ...cf, EDGE: 'direct' },
      { ...base, ...cf, APPS_DOMAIN: '' },
    ]) {
      const config = loadConfig(env)
      assert.equal(config.cloudflare, undefined, 'the agent still starts')
      assert.match(config.notices[0] ?? '', /CLOUDFLARE_API_TOKEN is set but unused/)
    }
    assert.deepEqual(loadConfig({ ...base, ...cf }).notices, [])
  })

  it('refuses invalid ids once the settings are in use', () => {
    assert.throws(() => loadConfig({ ...base, ...cf, CLOUDFLARE_ACCOUNT_ID: 'x' }))
    assert.throws(() => loadConfig({ ...base, ...cf, CLOUDFLARE_TUNNEL_ID: 'x' }))
    assert.throws(() => loadConfig({ ...base, ...cf, CLOUDFLARE_ACCESS_POLICY_ID: 'x' }))
  })
})
