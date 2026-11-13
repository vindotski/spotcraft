import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { buildApp } from '../src/app.ts'
import type { AgentSettings } from '../src/app-spec.ts'
import { Apps } from '../src/apps.ts'
import { loadConfig } from '../src/config.ts'
import type { Runner } from '../src/runner.ts'
import { Store } from '../src/store.ts'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const auth = { authorization: `Bearer ${TOKEN}` }
const spec = { image: 'vindotski/tagtape', tag: '2.0.0' }

// Every docker call succeeds; `docker ps` lists nothing.
const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' })

describe('apps domain (ADR 0021)', () => {
  let dir: string
  let app: ReturnType<typeof buildApp>
  const start = (settings: AgentSettings) => {
    app = buildApp({
      token: TOKEN,
      apps: new Apps(new Store(dir), run, 'caddy', undefined, settings),
    })
  }
  const put = (name: string, payload: object) =>
    app.inject({ method: 'PUT', url: `/apps/${name}`, headers: auth, payload })
  const site = (name: string) => readFile(join(dir, `sites/${name}.caddy`), 'utf8')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-domain-'))
  })
  afterEach(async () => {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('serves every app at <name>.<APPS_DOMAIN>, with no domain needed', async () => {
    start({ appsDomain: 'spotcraft.dev', edge: 'direct' })
    const res = await put('tagtape', spec)
    assert.equal(res.statusCode, 200, res.body)
    assert.deepEqual(res.json().hostnames, ['tagtape.spotcraft.dev'])
    assert.match(await site('tagtape'), /^tagtape\.spotcraft\.dev \{$/m)
    const settings = await app.inject({ url: '/settings', headers: auth })
    assert.deepEqual(settings.json(), {
      appsDomain: 'spotcraft.dev',
      edge: 'direct',
      dns: false,
      access: false,
    })
  })

  it('adds a custom domain next to the default host, with www. for a root', async () => {
    start({ appsDomain: 'spotcraft.dev', edge: 'direct' })
    const res = await put('tagtape', { ...spec, domain: 'tagtape.app' })
    assert.deepEqual(res.json().hostnames, ['tagtape.spotcraft.dev', 'tagtape.app'])
    const text = await site('tagtape')
    assert.match(text, /^tagtape\.spotcraft\.dev, tagtape\.app \{$/m)
    assert.match(text, /^www\.tagtape\.app \{$/m)
    assert.match(text, /header_up X-Forwarded-For \{client_ip\}/)
  })

  it('serves plain HTTP behind Cloudflare', async () => {
    start({ appsDomain: 'spotcraft.dev', edge: 'cloudflare' })
    await put('tagtape', { ...spec, domain: 'tagtape.app' })
    const text = await site('tagtape')
    assert.match(text, /^http:\/\/tagtape\.spotcraft\.dev, http:\/\/tagtape\.app \{$/m)
    assert.match(text, /^http:\/\/www\.tagtape\.app \{$/m)
  })

  it('rewrites every site when the edge changes, and reloads Caddy once', async () => {
    start({ appsDomain: 'spotcraft.dev', edge: 'direct' })
    await put('tagtape', { ...spec, domain: 'tagtape.app' })
    await put('blog', spec)
    const reloads: string[][] = []
    const counting: Runner = async (_file, args) => {
      if (args.includes('reload')) reloads.push(args)
      return { code: 0, stdout: '', stderr: '' }
    }
    const behindTunnel = new Apps(new Store(dir), counting, 'caddy', undefined, {
      appsDomain: 'spotcraft.dev',
      edge: 'cloudflare',
    })
    assert.deepEqual(await behindTunnel.refreshSites(), ['blog', 'tagtape'])
    assert.match(
      await site('tagtape'),
      /^http:\/\/tagtape\.spotcraft\.dev, http:\/\/tagtape\.app \{$/m,
    )
    assert.match(await site('blog'), /^http:\/\/blog\.spotcraft\.dev \{$/m)
    assert.equal(reloads.length, 1)
    assert.deepEqual(await behindTunnel.refreshSites(), [], 'nothing left to change')
    assert.equal(reloads.length, 1, 'no reload without a change')
  })

  it('retries the reload after Caddy failed, even with nothing new to write', async () => {
    start({ appsDomain: 'spotcraft.dev', edge: 'direct' })
    await put('tagtape', spec)
    let caddyUp = false
    const flaky: Runner = async (_file, args) =>
      args.includes('reload') && !caddyUp
        ? { code: 1, stdout: '', stderr: 'caddy starting' }
        : { code: 0, stdout: '', stderr: '' }
    const apps = new Apps(new Store(dir), flaky, 'caddy', undefined, {
      appsDomain: 'spotcraft.dev',
      edge: 'cloudflare',
    })
    await assert.rejects(apps.refreshSites())
    caddyUp = true
    assert.deepEqual(await apps.refreshSites(), [], 'already written')
  })

  it('requires a domain when there is no apps domain', async () => {
    start({ edge: 'direct' })
    assert.equal((await put('tagtape', spec)).statusCode, 400)
    assert.equal((await put('tagtape', { ...spec, domain: 'tagtape.app' })).statusCode, 200)
  })

  it("refuses a custom domain that is another app's default host, and reserved names", async () => {
    start({ appsDomain: 'spotcraft.dev', edge: 'direct' })
    await put('tagtape', spec)
    const res = await put('other', { ...spec, domain: 'tagtape.spotcraft.dev' })
    assert.equal(res.statusCode, 409)
    assert.match(res.json().error, /used by tagtape/)
    assert.equal((await put('www', spec)).statusCode, 400)
    // An app's own default host as its domain is the same host, not a clash.
    assert.equal(
      (await put('tagtape', { ...spec, domain: 'tagtape.spotcraft.dev' })).statusCode,
      200,
    )
  })
})

describe('config', () => {
  const base = { AGENT_TOKEN: TOKEN }
  it('reads APPS_DOMAIN and EDGE, defaulting to direct', () => {
    assert.deepEqual((({ appsDomain, edge }) => ({ appsDomain, edge }))(loadConfig(base)), {
      appsDomain: undefined,
      edge: 'direct',
    })
    const config = loadConfig({ ...base, APPS_DOMAIN: 'Spotcraft.dev', EDGE: 'cloudflare' })
    assert.equal(config.appsDomain, 'spotcraft.dev')
    assert.equal(config.edge, 'cloudflare')
  })
  it('rejects a bad APPS_DOMAIN or EDGE', () => {
    assert.throws(() => loadConfig({ ...base, APPS_DOMAIN: 'https://x.dev' }))
    assert.throws(() => loadConfig({ ...base, EDGE: 'nginx' }))
  })
})
