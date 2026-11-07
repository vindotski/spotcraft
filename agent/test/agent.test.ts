import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { buildApp } from '../src/app.ts'
import { Apps } from '../src/apps.ts'
import type { Runner, RunResult } from '../src/runner.ts'
import { Store } from '../src/store.ts'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const auth = { authorization: `Bearer ${TOKEN}` }

/** Records docker calls; `fail` makes a matching call return an error. */
function fakeDocker() {
  const calls: string[][] = []
  let fail: ((args: string[]) => boolean) | undefined
  const run: Runner = async (_file, args): Promise<RunResult> => {
    calls.push(args)
    if (fail?.(args)) return { code: 1, stdout: '', stderr: 'boom' }
    if (args.includes('ps')) {
      return {
        code: 0,
        stdout: '{"State":"running","Health":"healthy","Status":"Up 1 minute (healthy)"}\n',
        stderr: '',
      }
    }
    if (args.includes('logs')) return { code: 0, stdout: 'line 1\nline 2\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return {
    run,
    calls,
    failWhen: (match: (args: string[]) => boolean) => {
      fail = match
    },
  }
}

const spec = {
  image: 'vindotski/tagtape',
  tag: '2.0.0',
  domain: 'tagtape.app',
  env: { TRUST_PROXY: '1', PRICE: 'costs $5' },
}

describe('agent', () => {
  let dir: string
  let docker: ReturnType<typeof fakeDocker>
  let app: ReturnType<typeof buildApp>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-agent-'))
    docker = fakeDocker()
    app = buildApp({ token: TOKEN, apps: new Apps(new Store(dir), docker.run, 'caddy-test') })
  })
  afterEach(async () => {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('serves /health without a token and refuses everything else without one', async () => {
    assert.equal((await app.inject({ url: '/health' })).statusCode, 200)
    assert.equal((await app.inject({ url: '/apps' })).statusCode, 401)
    const wrong = await app.inject({ url: '/apps', headers: { authorization: 'Bearer nope' } })
    assert.equal(wrong.statusCode, 401)
  })

  it('deploys an app: hardened compose file, Caddy site, pull, up, reload', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/apps/tagtape',
      headers: auth,
      payload: spec,
    })
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(res.json().state, 'running')
    assert.equal(res.json().health, 'healthy')

    const compose = JSON.parse(await readFile(join(dir, 'apps/tagtape/compose.yaml'), 'utf8'))
    const service = compose.services.tagtape
    assert.equal(compose.name, 'spotcraft-app-tagtape')
    assert.equal(service.image, 'vindotski/tagtape:2.0.0')
    assert.deepEqual(service.cap_drop, ['ALL'])
    assert.equal(service.read_only, true)
    assert.equal(service.mem_limit, '512m')
    assert.equal(service.environment.PRICE, 'costs $$5', 'dollar signs are escaped for Compose')
    assert.deepEqual(service.networks.edge.aliases, ['app-tagtape'])
    assert.equal(compose.networks.edge.name, 'spotcraft-edge')

    const site = await readFile(join(dir, 'sites/tagtape.caddy'), 'utf8')
    assert.match(site, /^tagtape\.app \{$/m)
    assert.match(site, /reverse_proxy app-tagtape:3000/)
    assert.match(site, /^www\.tagtape\.app \{$/m)

    const steps = docker.calls.map((args) => args.find((a) => ['pull', 'up', 'reload'].includes(a)))
    assert.deepEqual(steps.filter(Boolean), ['pull', 'up', 'reload'])
  })

  it('turns away clients that are not on the allowlist, before the token check', async () => {
    const guarded = buildApp({
      token: TOKEN,
      apps: new Apps(new Store(dir), docker.run, 'caddy-test'),
      allowedIps: ['10.0.0.3'],
    })
    const from = (remoteAddress: string) =>
      guarded.inject({ url: '/apps', headers: auth, remoteAddress })
    assert.equal((await from('172.18.0.5')).statusCode, 403, 'an app container')
    assert.equal((await from('10.0.0.3')).statusCode, 200, 'the ops server')
    assert.equal((await from('::ffff:10.0.0.3')).statusCode, 200, 'the ops server, dual-stack')
    assert.equal((await from('127.0.0.1')).statusCode, 200, 'the container itself (health check)')
    await guarded.close()
  })

  it('adds a www. redirect for root domains only', async () => {
    await app.inject({ method: 'PUT', url: '/apps/root', headers: auth, payload: spec })
    const sub = { ...spec, domain: 'app.vin.ski' }
    await app.inject({ method: 'PUT', url: '/apps/sub', headers: auth, payload: sub })
    assert.match(await readFile(join(dir, 'sites/root.caddy'), 'utf8'), /^www\.tagtape\.app \{$/m)
    const subSite = await readFile(join(dir, 'sites/sub.caddy'), 'utf8')
    assert.match(subSite, /^app\.vin\.ski \{$/m)
    assert.doesNotMatch(subSite, /www\./)
  })

  it('rejects invalid names, domains, images, reserved names and unknown fields', async () => {
    const put = (name: string, payload: object) =>
      app.inject({ method: 'PUT', url: `/apps/${name}`, headers: auth, payload })
    assert.equal((await put('Bad_Name', spec)).statusCode, 400)
    assert.equal((await put('caddy', spec)).statusCode, 400)
    assert.equal((await put('ok', { ...spec, domain: 'evil.app {\n}' })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, image: 'UPPER/case' })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, tag: '-x' })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, env: { 'BAD-KEY': 'x' } })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, privileged: true })).statusCode, 400)
    assert.equal(docker.calls.length, 0, 'nothing reaches docker')
  })

  it('refuses a domain another app already uses', async () => {
    await app.inject({ method: 'PUT', url: '/apps/one', headers: auth, payload: spec })
    const res = await app.inject({ method: 'PUT', url: '/apps/two', headers: auth, payload: spec })
    assert.equal(res.statusCode, 409)
  })

  it('removes a new app completely when it fails to start', async () => {
    docker.failWhen((args) => args.includes('up') && args.includes('--wait'))
    const res = await app.inject({
      method: 'PUT',
      url: '/apps/tagtape',
      headers: auth,
      payload: spec,
    })
    assert.equal(res.statusCode, 502)
    await assert.rejects(stat(join(dir, 'apps/tagtape')))
    await assert.rejects(stat(join(dir, 'sites/tagtape.caddy')))
  })

  it('puts the previous version back when an update fails', async () => {
    await app.inject({ method: 'PUT', url: '/apps/tagtape', headers: auth, payload: spec })
    docker.failWhen((args) => args.includes('pull'))
    const res = await app.inject({
      method: 'PUT',
      url: '/apps/tagtape',
      headers: auth,
      payload: { ...spec, tag: '9.9.9' },
    })
    assert.equal(res.statusCode, 502)
    const stored = JSON.parse(await readFile(join(dir, 'apps/tagtape/app.json'), 'utf8'))
    assert.equal(stored.tag, '2.0.0')
  })

  it('lists, shows logs for and removes apps', async () => {
    await app.inject({ method: 'PUT', url: '/apps/tagtape', headers: auth, payload: spec })
    const list = await app.inject({ url: '/apps', headers: auth })
    assert.deepEqual(
      list.json().apps.map((a: { name: string }) => a.name),
      ['tagtape'],
    )
    const logs = await app.inject({ url: '/apps/tagtape/logs?tail=10', headers: auth })
    assert.equal(logs.body, 'line 1\nline 2\n')
    const del = await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
    assert.equal(del.statusCode, 204)
    assert.equal((await app.inject({ url: '/apps/tagtape', headers: auth })).statusCode, 404)
    const again = await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
    assert.equal(again.statusCode, 404)
  })
})
