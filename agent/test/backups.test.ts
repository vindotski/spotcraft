import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { buildApp } from '../src/app.ts'
import { Apps } from '../src/apps.ts'
import { type BackupTarget, backupStamp, untilNext } from '../src/backups.ts'
import type { Runner } from '../src/runner.ts'
import { amzDate, S3, signV4 } from '../src/s3.ts'
import { Store } from '../src/store.ts'

const TOKEN = 'test-token-0123456789abcdef0123456789'
const auth = { authorization: `Bearer ${TOKEN}` }

describe('S3 signing', () => {
  it("matches AWS's published Signature Version 4 example (GET Object)", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const authorization = signV4({
      method: 'GET',
      path: '/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': emptyHash,
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: emptyHash,
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    })
    assert.equal(
      authorization,
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('puts an object path-style, signed, with its hash', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
    const s3 = new S3(
      {
        endpoint: 'https://acct.r2.cloudflarestorage.com/',
        bucket: 'spotcraft-backups',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
      fakeFetch,
      () => new Date('2026-11-14T03:00:00Z'),
    )
    await s3.put('blog/20261114T030000Z/app.json', Buffer.from('{}'), 'application/json')
    const [{ url, init }] = seen
    assert.equal(
      url,
      'https://acct.r2.cloudflarestorage.com/spotcraft-backups/blog/20261114T030000Z/app.json',
    )
    const headers = init.headers as Record<string, string>
    assert.equal(headers['x-amz-date'], '20261114T030000Z')
    assert.equal(
      headers['x-amz-content-sha256'],
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    )
    assert.match(headers.authorization ?? '', /Credential=key\/20261114\/auto\/s3\/aws4_request/)
  })

  it("throws with the bucket's answer when a put fails", async () => {
    const fakeFetch = (async () =>
      new Response('<Error>AccessDenied</Error>', { status: 403 })) as unknown as typeof fetch
    const s3 = new S3(
      { endpoint: 'https://x.example', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' },
      fakeFetch,
    )
    await assert.rejects(s3.put('a/b', Buffer.from('x')), /403 for a\/b: <Error>AccessDenied/)
  })

  it('formats times for x-amz-date and keys', () => {
    const date = new Date('2026-11-14T03:04:05.678Z')
    assert.equal(amzDate(date), '20261114T030405Z')
    assert.equal(backupStamp(date), '20261114T030405Z')
  })

  it('waits until the next 03:00 UTC', () => {
    assert.equal(untilNext(3, new Date('2026-11-14T02:00:00Z')), 3_600_000)
    assert.equal(untilNext(3, new Date('2026-11-14T03:00:00Z')), 24 * 3_600_000)
    assert.equal(untilNext(3, new Date('2026-11-14T04:00:00Z')), 23 * 3_600_000)
  })
})

/** A runner where every app's deploy works. */
const docker: Runner = async (_file, args) => {
  if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '' }
  return { code: 0, stdout: '', stderr: '' }
}

function fakeBucket() {
  const objects = new Map<string, Buffer>()
  let failing = false
  const target: BackupTarget = {
    async put(key, body) {
      if (failing) throw new Error('The bucket answered 403')
      objects.set(key, Buffer.from(body))
    },
  }
  return { target, objects, fail: (on = true) => (failing = on) }
}

describe('backups', () => {
  let dir: string
  let bucket: ReturnType<typeof fakeBucket>
  let apps: Apps
  let app: ReturnType<typeof buildApp>
  const dumped: string[] = []
  let clock = new Date('2026-11-14T03:00:00Z')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-backups-'))
    bucket = fakeBucket()
    dumped.length = 0
    const databases = {
      async provision(name: string, password: string) {
        return `postgres://app_${name}:${password}@postgres:5432/app_${name}`
      },
      async purge() {},
      async listUsers() {
        return { available: true, total: 0, users: [] }
      },
      async deleteUser() {
        return false
      },
    }
    apps = new Apps(new Store(dir), docker, 'caddy', databases, undefined, undefined, {
      target: bucket.target,
      dump: async (database) => {
        dumped.push(database)
        return Buffer.from(`dump of ${database}`)
      },
      now: () => clock,
    })
    app = buildApp({ token: TOKEN, apps })
    const base = { image: 'vindotski/x', tag: '1.0.0', env: { AUTH_SECRET: 'keep-me' } }
    const put = (name: string, database: boolean) =>
      app.inject({
        method: 'PUT',
        url: `/apps/${name}`,
        headers: auth,
        payload: { ...base, domain: `${name}.app`, database },
      })
    assert.equal((await put('sokobanko', true)).statusCode, 200)
    assert.equal((await put('site', false)).statusCode, 200)
  })
  afterEach(async () => {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('backs up each app: its dump if it has a database, its settings either way', async () => {
    const results = await apps.backupAll()
    assert.deepEqual(Object.keys(results).sort(), ['site', 'sokobanko'])
    assert.deepEqual(dumped, ['app_sokobanko'])
    assert.deepEqual([...bucket.objects.keys()].sort(), [
      'site/20261114T030000Z/app.json',
      'site/20261114T030000Z/secrets.json',
      'sokobanko/20261114T030000Z/app.json',
      'sokobanko/20261114T030000Z/database.dump',
      'sokobanko/20261114T030000Z/secrets.json',
    ])
    const spec = JSON.parse(
      bucket.objects.get('sokobanko/20261114T030000Z/app.json')?.toString() ?? '',
    )
    assert.equal(spec.env.AUTH_SECRET, 'keep-me', 'the env needed to restore sessions')
    const secrets = JSON.parse(
      bucket.objects.get('sokobanko/20261114T030000Z/secrets.json')?.toString() ?? '',
    )
    assert.ok(secrets.databasePassword)

    const status = JSON.parse(await readFile(join(dir, 'apps/sokobanko/backup.json'), 'utf8'))
    assert.deepEqual(status, {
      at: '2026-11-14T03:00:00.000Z',
      ok: true,
      key: 'sokobanko/20261114T030000Z/',
      bytes: 'dump of app_sokobanko'.length,
      lastOkAt: '2026-11-14T03:00:00.000Z',
    })
  })

  it('keeps when a backup last worked after one fails, and carries on with the next app', async () => {
    await apps.backupAll()
    clock = new Date('2026-11-15T03:00:00Z')
    bucket.fail()
    const results = await apps.backupAll()
    assert.equal(results.sokobanko?.ok, false)
    assert.equal(results.site?.ok, false, 'tried too')
    assert.match(results.sokobanko?.error ?? '', /403/)
    assert.equal(results.sokobanko?.lastOkAt, '2026-11-14T03:00:00.000Z')
    clock = new Date('2026-11-14T03:00:00Z')
  })

  it('carries on past a status file cut short, and writes it whole', async () => {
    await writeFile(join(dir, 'apps/sokobanko/backup.json'), '{"at": "2026-11-1')
    const results = await apps.backupAll()
    assert.equal(results.sokobanko?.ok, true)
    assert.equal(results.site?.ok, true, 'the next app too')
    const status = JSON.parse(await readFile(join(dir, 'apps/sokobanko/backup.json'), 'utf8'))
    assert.equal(status.ok, true)
    const listed = await app.inject({ url: '/backups', headers: auth })
    assert.equal(listed.statusCode, 200)
  })

  it('refuses a second backup on request while one is waiting', async () => {
    const first = apps.backup('sokobanko')
    await assert.rejects(apps.backup('sokobanko'), /already queued/)
    assert.equal((await first).ok, true)
    assert.equal((await apps.backup('sokobanko')).ok, true, 'and allows it again once done')
  })

  it('serves statuses, backs up on request, and refuses when backups are off', async () => {
    const before = await app.inject({ url: '/backups', headers: auth })
    assert.deepEqual(before.json(), { enabled: true, apps: { site: null, sokobanko: null } })
    const now = await app.inject({ method: 'POST', url: '/apps/sokobanko/backup', headers: auth })
    assert.equal(now.statusCode, 200, now.body)
    assert.equal(now.json().ok, true)
    const one = await app.inject({ url: '/apps/sokobanko/backup', headers: auth })
    assert.equal(one.json().key, 'sokobanko/20261114T030000Z/')
    assert.equal((await app.inject({ url: '/apps/nope/backup', headers: auth })).statusCode, 404)

    const without = buildApp({ token: TOKEN, apps: new Apps(new Store(dir), docker, 'caddy') })
    const off = await without.inject({
      method: 'POST',
      url: '/apps/sokobanko/backup',
      headers: auth,
    })
    assert.equal(off.statusCode, 409)
    assert.equal((await without.inject({ url: '/backups', headers: auth })).json().enabled, false)
    await without.close()
  })
})
