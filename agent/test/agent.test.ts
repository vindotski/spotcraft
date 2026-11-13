import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { buildApp } from '../src/app.ts'
import { Apps, type Databases } from '../src/apps.ts'
import type { Runner, RunResult } from '../src/runner.ts'
import { Store } from '../src/store.ts'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const auth = { authorization: `Bearer ${TOKEN}` }

/**
 * Records docker calls and keeps track of containers, as `<project>/<service>` (also their ID);
 * `fail` makes a matching call return an error.
 */
function fakeDocker() {
  const calls: string[][] = []
  const running = new Set<string>(['spotcraft-apps/caddy'])
  let fail: ((args: string[]) => boolean) | undefined
  const run: Runner = async (_file, args): Promise<RunResult> => {
    calls.push(args)
    if (fail?.(args)) return { code: 1, stdout: '', stderr: 'boom' }
    const project = args[0] === 'compose' ? args[args.indexOf('-p') + 1] : undefined
    // `docker compose -p <project> … up … <service>` starts that service's container; `down`
    // removes all of the project's, `rm --stop --force <service>` that service's.
    if (project && args.includes('up')) running.add(`${project}/${args.at(-1)}`)
    if (project && args.includes('down')) {
      for (const id of running) if (id.startsWith(`${project}/`)) running.delete(id)
    }
    if (project && args.includes('rm')) running.delete(`${project}/${args.at(-1)}`)
    // `docker rm <id>…` (after `docker stop`).
    if (args[0] === 'rm') for (const id of args.slice(1)) running.delete(id)
    if (args[0] === 'ps') {
      // Like `docker ps --format json`: one line per container, labels as one string.
      const only = /=(spotcraft-app-[^,]+)$/.exec(args[args.indexOf('--filter') + 1])?.[1]
      const rows = [...running]
        .filter((id) => !only || id.startsWith(`${only}/`))
        .map((id) => {
          const [p, service] = id.split('/')
          return JSON.stringify({
            ID: id,
            Labels: `com.docker.compose.oneoff=False,com.docker.compose.project=${p},com.docker.compose.service=${service}`,
            State: 'running',
            Status: 'Up 1 minute (healthy)',
          })
        })
      return { code: 0, stdout: `${rows.join('\n')}\n`, stderr: '' }
    }
    if (args.includes('logs')) return { code: 0, stdout: 'line 1\nline 2\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return {
    run,
    calls,
    running,
    failWhen: (match: (args: string[]) => boolean) => {
      fail = match
    },
  }
}

const GUEST_ID = '8a22a41f-636c-4249-99b7-95aafff1346e'

/** Records database calls; `failing` makes provision throw. */
function fakeDatabases() {
  const calls: string[][] = []
  let failing = false
  const databases: Databases = {
    async provision(name, password) {
      calls.push(['provision', name, password])
      if (failing) throw new Error('connection refused')
      return `postgres://app_${name}:${password}@postgres:5432/app_${name}`
    },
    async purge(name) {
      calls.push(['purge', name])
    },
    async listUsers(name, { limit, cursor }) {
      calls.push(['listUsers', name, String(limit), cursor ?? ''])
      return {
        available: true,
        total: 1,
        users: [
          { id: GUEST_ID, guest: true, createdAt: '2026-11-08T00:00:00.000Z', lastSeen: null },
        ],
        next: 'b2xkZXI',
      }
    },
    async deleteUser(name, id) {
      calls.push(['deleteUser', name, id])
      return id === GUEST_ID
    },
  }
  return { databases, calls, fail: () => (failing = true) }
}

const spec = {
  image: 'vindotski/tagtape',
  tag: '2.0.0',
  domain: 'tagtape.app',
  env: { TRUST_PROXY: '1', PRICE: 'costs $5' },
}

/** `spec` with the defaults the API fills in, for calling `Apps` directly. */
const fullSpec = { ...spec, port: 3000, memory: '512m', cpus: 1, readOnly: true, database: false }

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

  it('deploys an app into its first slot: hardened compose file, Caddy site, pull, up, reload', async () => {
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
    assert.deepEqual(Object.keys(compose.services), ['tagtape-blue'])
    const service = compose.services['tagtape-blue']
    assert.equal(compose.name, 'spotcraft-app-tagtape')
    assert.equal(service.image, 'vindotski/tagtape:2.0.0')
    assert.deepEqual(service.cap_drop, ['ALL'])
    assert.equal(service.read_only, true)
    assert.equal(service.mem_limit, '512m')
    assert.equal(service.environment.PRICE, 'costs $$5', 'dollar signs are escaped for Compose')
    assert.deepEqual(service.networks.edge.aliases, ['app-tagtape-blue'])
    assert.equal(compose.networks.edge.name, 'spotcraft-edge')

    const site = await readFile(join(dir, 'sites/tagtape.caddy'), 'utf8')
    assert.match(site, /^tagtape\.app \{$/m)
    assert.match(site, /reverse_proxy app-tagtape-blue:3000/)
    assert.match(site, /^www\.tagtape\.app \{$/m)

    const steps = docker.calls.map((args) => args.find((a) => ['pull', 'up', 'reload'].includes(a)))
    assert.deepEqual(steps.filter(Boolean), ['pull', 'up', 'reload'])
    const up = docker.calls.find((args) => args.includes('up'))
    assert.equal(up?.at(-1), 'tagtape-blue', 'only the new slot is started')
    assert.ok(!up?.includes('--remove-orphans'))
  })

  describe('slots (ADR 0028)', () => {
    const deploy = (tag: string) =>
      app.inject({ method: 'PUT', url: '/apps/tagtape', headers: auth, payload: { ...spec, tag } })
    const site = () => readFile(join(dir, 'sites/tagtape.caddy'), 'utf8')
    const containers = () => [...docker.running].filter((id) => id.startsWith('spotcraft-app-'))

    it('starts the other slot, moves traffic once it is healthy, then stops the old one', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      docker.calls.length = 0
      const res = await deploy('2.1.0')
      assert.equal(res.statusCode, 200, res.body)
      assert.match(await site(), /reverse_proxy app-tagtape-green:3000/)
      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-green'])

      // The old slot stops only after Caddy has moved traffic, and gets time to finish.
      const step = (args: string[]) =>
        args.includes('up')
          ? `up ${args.at(-1)}`
          : args.includes('reload')
            ? 'reload'
            : args[0] === 'stop' || args[0] === 'rm'
              ? `${args[0]} ${args.slice(-1)}`
              : undefined
      assert.deepEqual(docker.calls.map(step).filter(Boolean), [
        'up tagtape-green',
        'reload',
        'stop spotcraft-app-tagtape/tagtape-blue',
        'rm spotcraft-app-tagtape/tagtape-blue',
      ])
      const stop = docker.calls.find((args) => args[0] === 'stop')
      assert.deepEqual(stop?.slice(0, 3), ['stop', '--time', '30'])

      // And back to blue on the next deploy.
      assert.equal((await deploy('2.2.0')).statusCode, 200)
      assert.match(await site(), /reverse_proxy app-tagtape-blue:3000/)
      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-blue'])
    })

    it('leaves the live slot serving, untouched, when the new one fails to become healthy', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      const before = await readFile(join(dir, 'apps/tagtape/compose.yaml'), 'utf8')
      docker.failWhen((args) => args.includes('up'))
      docker.calls.length = 0
      assert.equal((await deploy('9.9.9')).statusCode, 502)

      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-blue'])
      assert.match(await site(), /reverse_proxy app-tagtape-blue:3000/)
      assert.equal(await readFile(join(dir, 'apps/tagtape/compose.yaml'), 'utf8'), before)
      const stored = JSON.parse(await readFile(join(dir, 'apps/tagtape/app.json'), 'utf8'))
      assert.equal(stored.tag, '2.0.0')
      // The failed slot is removed; the live one is never stopped or restarted.
      assert.ok(docker.calls.some((args) => args.includes('rm') && args.at(-1) === 'tagtape-green'))
      assert.ok(!docker.calls.some((args) => args[0] === 'stop'))
      assert.ok(!docker.calls.some((args) => args.includes('up') && args.at(-1) === 'tagtape-blue'))
    })

    it('moves an app deployed before slots into one, then removes its old container', async () => {
      // As an older agent left it: one service named after the app, reached as app-tagtape.
      await mkdir(join(dir, 'apps/tagtape'), { recursive: true })
      await mkdir(join(dir, 'sites'), { recursive: true })
      await writeFile(
        join(dir, 'apps/tagtape/app.json'),
        JSON.stringify({
          ...spec,
          name: 'tagtape',
          port: 3000,
          memory: '512m',
          cpus: 1,
          readOnly: true,
          database: false,
        }),
      )
      await writeFile(
        join(dir, 'apps/tagtape/compose.yaml'),
        JSON.stringify({ name: 'spotcraft-app-tagtape', services: { tagtape: {} } }),
      )
      await writeFile(join(dir, 'sites/tagtape.caddy'), 'reverse_proxy app-tagtape:3000\n')
      docker.running.add('spotcraft-app-tagtape/tagtape')

      const status = await app.inject({ url: '/apps/tagtape', headers: auth })
      assert.equal(status.json().state, 'running', 'its status is still found')

      assert.equal((await deploy('2.1.0')).statusCode, 200)
      assert.match(await site(), /reverse_proxy app-tagtape-blue:3000/)
      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-blue'])
    })

    it('reports the live slot while both run', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      // A deploy in progress: green started, blue still live.
      docker.running.add('spotcraft-app-tagtape/tagtape-green')
      const res = await app.inject({ url: '/apps/tagtape', headers: auth })
      assert.equal(res.json().state, 'running')
      const listed = await app.inject({ url: '/apps', headers: auth })
      assert.equal(listed.json().apps.length, 1)
    })

    it('recovers from a deploy that stopped before its commit: the live slot stays', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      // As an agent that stopped after starting green, before committing it.
      const apps = new Apps(new Store(dir), docker.run, 'caddy-test')
      await new Store(dir).stage('tagtape', {
        spec: JSON.stringify({ ...fullSpec, name: 'tagtape', tag: '9.9.9' }),
        compose: JSON.stringify({
          name: 'spotcraft-app-tagtape',
          services: { 'tagtape-green': {} },
        }),
      })
      docker.running.add('spotcraft-app-tagtape/tagtape-green')
      docker.calls.length = 0

      await apps.recover()
      assert.match(await site(), /reverse_proxy app-tagtape-blue:3000/)
      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-blue'])
      await assert.rejects(stat(join(dir, 'apps/tagtape/compose.next.yaml')))
      await assert.rejects(stat(join(dir, 'apps/tagtape/app.next.json')))
      const stored = JSON.parse(await readFile(join(dir, 'apps/tagtape/app.json'), 'utf8'))
      assert.equal(stored.tag, '2.0.0')
      // Caddy reloads before the stray slot goes.
      const reload = docker.calls.findIndex((args) => args.includes('reload'))
      const stop = docker.calls.findIndex((args) => args[0] === 'stop')
      assert.ok(reload >= 0 && reload < stop, 'reload, then stop')
    })

    it('recovers from a deploy that committed but never removed the old slot', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      docker.failWhen((args) => args[0] === 'stop')
      assert.equal((await deploy('2.1.0')).statusCode, 200, 'a failed stop only costs memory')
      assert.equal(containers().length, 2)
      docker.failWhen(() => false)

      await new Apps(new Store(dir), docker.run, 'caddy-test').recover()
      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-green'])
      assert.match(await site(), /reverse_proxy app-tagtape-green:3000/)
    })

    it('finishes a commit that stopped between its two renames', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      const store = new Store(dir)
      await store.stage('tagtape', {
        spec: JSON.stringify({ ...fullSpec, name: 'tagtape', tag: '2.1.0' }),
        compose: JSON.stringify({
          name: 'spotcraft-app-tagtape',
          services: { 'tagtape-green': {} },
        }),
      })
      // The compose file was renamed (the commit), the spec wasn't.
      await rename(
        join(dir, 'apps/tagtape/compose.next.yaml'),
        join(dir, 'apps/tagtape/compose.yaml'),
      )
      docker.running.add('spotcraft-app-tagtape/tagtape-green')

      await new Apps(store, docker.run, 'caddy-test').recover()
      const stored = JSON.parse(await readFile(join(dir, 'apps/tagtape/app.json'), 'utf8'))
      assert.equal(stored.tag, '2.1.0')
      assert.match(await site(), /reverse_proxy app-tagtape-green:3000/)
      assert.deepEqual(containers(), ['spotcraft-app-tagtape/tagtape-green'])
    })

    it('removes both slots with the app', async () => {
      assert.equal((await deploy('2.0.0')).statusCode, 200)
      docker.running.add('spotcraft-app-tagtape/tagtape-green')
      const res = await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
      assert.equal(res.statusCode, 204)
      assert.deepEqual(containers(), [])
    })
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
    assert.equal((await from('10.0.0.3')).statusCode, 200, 'the dashboard')
    assert.equal((await from('::ffff:10.0.0.3')).statusCode, 200, 'the dashboard, dual-stack')
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
    // The server's own services on the shared networks (ADR 0026).
    for (const reserved of ['dashboard', 'victoriametrics', 'cloudflared', 'blackbox']) {
      assert.equal((await put(reserved, spec)).statusCode, 400, reserved)
    }
    // `app-<name>` is the alias Caddy reaches each app by: `app-blog` would answer for `blog`.
    assert.equal((await put('app-blog', spec)).statusCode, 400)
    // `<name>-blue` and `<name>-green` are the slots' services (ADR 0028).
    assert.equal((await put('blog-blue', spec)).statusCode, 400)
    assert.equal((await put('blog-green', spec)).statusCode, 400)
    assert.equal((await put('ok', { ...spec, domain: 'evil.app {\n}' })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, image: 'UPPER/case' })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, tag: '-x' })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, env: { 'BAD-KEY': 'x' } })).statusCode, 400)
    assert.equal((await put('ok', { ...spec, privileged: true })).statusCode, 400)
    assert.equal(docker.calls.length, 0, 'nothing reaches docker')
  })

  it("keeps each app's app.json (its env) and compose file (its database password) private", async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/apps/tagtape',
      headers: auth,
      payload: spec,
    })
    assert.equal(res.statusCode, 200, res.body)
    for (const file of ['app.json', 'compose.yaml']) {
      const { mode } = await stat(join(dir, 'apps/tagtape', file))
      assert.equal(mode & 0o777, 0o600, file)
    }
  })

  it('locks down app files an older agent left readable, in incomplete app directories too', async () => {
    const apps = new Apps(new Store(dir), docker.run, 'caddy-test')
    await apps.deploy({ ...fullSpec, name: 'tagtape' })
    await chmod(join(dir, 'apps/tagtape/app.json'), 0o644)
    // Not a complete app (no compose file or site), so it isn't listed, but its env is there.
    await mkdir(join(dir, 'apps/broken'), { recursive: true })
    await writeFile(join(dir, 'apps/broken/app.json'), '{}', { mode: 0o644 })
    await writeFile(join(dir, 'apps/broken/secrets.json'), '{}', { mode: 0o644 })
    await apps.recover()
    for (const file of ['tagtape/app.json', 'broken/app.json', 'broken/secrets.json']) {
      const { mode } = await stat(join(dir, 'apps', file))
      assert.equal(mode & 0o777, 0o600, file)
    }
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
    await app.inject({
      method: 'PUT',
      url: '/apps/other',
      headers: auth,
      payload: { ...spec, domain: 'other.app' },
    })
    const calls = docker.calls.length
    const list = await app.inject({ url: '/apps', headers: auth })
    assert.deepEqual(
      list
        .json()
        .apps.map((a: { name: string; state: string; health: string }) => [
          a.name,
          a.state,
          a.health,
        ]),
      [
        ['other', 'running', 'healthy'],
        ['tagtape', 'running', 'healthy'],
      ],
    )
    assert.equal(docker.calls.length - calls, 1, 'one docker call for the whole list')
    const logs = await app.inject({ url: '/apps/tagtape/logs?tail=10', headers: auth })
    assert.equal(logs.body, 'line 1\nline 2\n')
    const del = await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
    assert.equal(del.statusCode, 204)
    assert.equal((await app.inject({ url: '/apps/tagtape', headers: auth })).statusCode, 404)
    const after = await app.inject({ url: '/apps', headers: auth })
    assert.deepEqual(
      after.json().apps.map((a: { name: string }) => a.name),
      ['other'],
    )
    const again = await app.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
    assert.equal(again.statusCode, 404)
  })

  describe('app databases', () => {
    let db: ReturnType<typeof fakeDatabases>
    let withDb: ReturnType<typeof buildApp>
    const dbSpec = { ...spec, database: true }
    const put = (payload: object, target = withDb) =>
      target.inject({ method: 'PUT', url: '/apps/tagtape', headers: auth, payload })

    beforeEach(() => {
      db = fakeDatabases()
      withDb = buildApp({
        token: TOKEN,
        apps: new Apps(new Store(dir), docker.run, 'caddy-test', db.databases),
      })
    })
    afterEach(() => withDb.close())

    it('prepares the database and gives the app DATABASE_URL', async () => {
      const res = await put(dbSpec)
      assert.equal(res.statusCode, 200, res.body)
      assert.equal(res.json().database, true)
      const [[step, name, password]] = db.calls
      assert.deepEqual([step, name], ['provision', 'tagtape'])
      assert.match(password, /^[0-9a-f]{48}$/)

      const compose = JSON.parse(await readFile(join(dir, 'apps/tagtape/compose.yaml'), 'utf8'))
      assert.equal(
        compose.services['tagtape-blue'].environment.DATABASE_URL,
        `postgres://app_tagtape:${password}@postgres:5432/app_tagtape`,
      )
      assert.equal(compose.services['tagtape-blue'].environment.TRUST_PROXY, '1')
    })

    it('keeps the password to itself and reuses it on the next deploy', async () => {
      await put(dbSpec)
      await put({ ...dbSpec, tag: '2.0.1' })
      assert.equal(db.calls.length, 2)
      assert.equal(db.calls[0][2], db.calls[1][2], 'same password both times')

      const secrets = join(dir, 'apps/tagtape/secrets.json')
      assert.equal((await stat(secrets)).mode & 0o777, 0o600)
      const shown = await withDb.inject({ url: '/apps/tagtape', headers: auth })
      assert.doesNotMatch(shown.body, new RegExp(db.calls[0][2]))
      assert.doesNotMatch(await readFile(join(dir, 'apps/tagtape/app.json'), 'utf8'), /password/i)
    })

    it('changes nothing when the database cannot be prepared', async () => {
      db.fail()
      const res = await put(dbSpec)
      assert.equal(res.statusCode, 502)
      assert.match(res.json().output, /connection refused/)
      await assert.rejects(stat(join(dir, 'apps/tagtape')))
      assert.equal(docker.calls.length, 0, 'nothing reaches docker')
    })

    it('refuses a database on a server without Postgres, and DATABASE_URL in env', async () => {
      assert.equal((await put(dbSpec, app)).statusCode, 409)
      const own = await put({ ...dbSpec, env: { DATABASE_URL: 'postgres://elsewhere/db' } })
      assert.equal(own.statusCode, 400)
      // Without a Spotcraft database, an app may point DATABASE_URL anywhere.
      const external = await put({ ...spec, env: { DATABASE_URL: 'postgres://elsewhere/db' } })
      assert.equal(external.statusCode, 200)
      assert.equal(db.calls.length, 0)
    })

    it('keeps the database setting when an update leaves it out', async () => {
      await put(dbSpec)
      const { database: _, ...withoutField } = dbSpec
      const res = await put({ ...withoutField, tag: '2.0.1' })
      assert.equal(res.json().database, true)
      const compose = JSON.parse(await readFile(join(dir, 'apps/tagtape/compose.yaml'), 'utf8'))
      // The update went into the other slot.
      assert.ok(compose.services['tagtape-green'].environment.DATABASE_URL)
      // A new app without the field gets no database.
      const fresh = await withDb.inject({
        method: 'PUT',
        url: '/apps/fresh',
        headers: auth,
        payload: { ...withoutField, domain: 'fresh.app' },
      })
      assert.equal(fresh.json().database, false)
    })

    it('keeps the database when an app is removed, unless asked to purge it', async () => {
      await put(dbSpec)
      const keep = await withDb.inject({ method: 'DELETE', url: '/apps/tagtape', headers: auth })
      assert.equal(keep.statusCode, 204)
      assert.deepEqual(
        db.calls.map(([step]) => step),
        ['provision'],
      )

      await put(dbSpec)
      const del = await withDb.inject({
        method: 'DELETE',
        url: '/apps/tagtape?purge=true',
        headers: auth,
      })
      assert.equal(del.statusCode, 204)
      assert.deepEqual(db.calls.at(-1), ['purge', 'tagtape'])
      const bad = await withDb.inject({ method: 'DELETE', url: '/apps/x?other=1', headers: auth })
      assert.equal(bad.statusCode, 400)
    })

    it('upgrades every app database, carrying on past failures', async () => {
      await put(dbSpec)
      await withDb.inject({
        method: 'PUT',
        url: '/apps/plain',
        headers: auth,
        payload: { ...spec, domain: 'plain.app' },
      })
      const apps = new Apps(new Store(dir), docker.run, 'caddy-test', db.databases)
      db.calls.length = 0
      assert.deepEqual(await apps.upgradeDatabases(), { upgraded: ['tagtape'], failed: [] })
      assert.deepEqual(
        db.calls.map(([step, name]) => [step, name]),
        [['provision', 'tagtape']],
      )
      db.fail()
      const { failed } = await apps.upgradeDatabases()
      assert.deepEqual(failed, [{ name: 'tagtape', error: 'connection refused' }])
    })

    describe('users', () => {
      const get = (url: string) => withDb.inject({ url, headers: auth })
      const del = (url: string) => withDb.inject({ method: 'DELETE', url, headers: auth })

      it("lists an app's users, passing the page through", async () => {
        await put(dbSpec)
        const res = await get('/apps/tagtape/users?limit=10&cursor=b2xkZXI')
        assert.equal(res.statusCode, 200, res.body)
        assert.equal(res.json().users[0].id, GUEST_ID)
        assert.equal(res.json().next, 'b2xkZXI')
        assert.deepEqual(db.calls.at(-1), ['listUsers', 'tagtape', '10', 'b2xkZXI'])
        await get('/apps/tagtape/users')
        assert.deepEqual(db.calls.at(-1), ['listUsers', 'tagtape', '50', ''], 'default limit')
      })

      it('deletes a user: 204, then 404', async () => {
        await put(dbSpec)
        assert.equal((await del(`/apps/tagtape/users/${GUEST_ID}`)).statusCode, 204)
        const other = '00000000-0000-4000-8000-000000000000'
        assert.equal((await del(`/apps/tagtape/users/${other}`)).statusCode, 404)
      })

      it('says why when there are no users to show', async () => {
        assert.equal((await get('/apps/nope/users')).statusCode, 404, 'no such app')
        await withDb.inject({
          method: 'PUT',
          url: '/apps/plain',
          headers: auth,
          payload: { ...spec, domain: 'plain.app' },
        })
        assert.equal((await get('/apps/plain/users')).statusCode, 409, 'no database')
        assert.equal(db.calls.filter(([step]) => step === 'listUsers').length, 0)
      })

      it('validates ids, limits and cursors before touching the database', async () => {
        await put(dbSpec)
        const calls = db.calls.length
        assert.equal((await del('/apps/tagtape/users/not-a-uuid')).statusCode, 400)
        assert.equal((await del(`/apps/tagtape/users/${GUEST_ID}';--`)).statusCode, 400)
        assert.equal((await get('/apps/tagtape/users?limit=0')).statusCode, 400)
        assert.equal((await get('/apps/tagtape/users?limit=500')).statusCode, 400)
        assert.equal((await get('/apps/tagtape/users?cursor=a%20b')).statusCode, 400)
        assert.equal((await get('/apps/tagtape/users?other=1')).statusCode, 400)
        assert.equal(db.calls.length, calls, 'nothing reached the database')
      })
    })
  })
})
