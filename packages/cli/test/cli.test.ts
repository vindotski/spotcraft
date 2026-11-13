import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { appName, localEnv, parseEnv, writeMissing } from '../src/project.ts'
import {
  ADMIN_SQL,
  composeFile,
  databaseUrl,
  PG_HBA,
  POSTGRES_IMAGE,
  type RunResult,
  StackError,
  up,
} from '../src/stack.ts'

const repo = new URL('../../../', import.meta.url)
const repoFile = (path: string) => readFile(new URL(path, repo), 'utf8')

describe('same as the server', () => {
  it('uses the Postgres image of the server and of CI', async () => {
    const compose = await repoFile('infra/server/compose.yaml')
    const ci = await repoFile('.github/workflows/ci.yml')
    const images = (text: string) => [...text.matchAll(/image: (postgres:\S+)/g)].map((m) => m[1])
    assert.deepEqual(images(compose), [POSTGRES_IMAGE])
    // CI has a database for each job that runs the kit's tests: every one must match.
    assert.ok(images(ci).length > 0)
    assert.deepEqual(new Set(images(ci)), new Set([POSTGRES_IMAGE]))
  })

  it('uses the login rules of the server', async () => {
    const rules = (text: string) =>
      text
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => line.trim().split(/\s+/).join(' '))
    assert.deepEqual(rules(PG_HBA), rules(await repoFile('infra/server/pg_hba.conf')))
  })

  it("sets up the agent's role with the deploy script's SQL", async () => {
    const script = await repoFile('infra/remote-deploy.sh')
    const sql = /cat <<'SQL'\n([\s\S]*?)\nSQL\n/.exec(script)?.[1]
    assert.equal(`${sql}\n`, ADMIN_SQL)
  })

  it('publishes Postgres on localhost only', () => {
    const compose = JSON.parse(composeFile())
    assert.deepEqual(compose.services.postgres.ports, ['127.0.0.1:54340:5432'])
    assert.equal(compose.configs.pg_hba.content, PG_HBA)
  })
})

describe('app name', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-cli-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const withPackage = (name: unknown) =>
    writeFile(join(dir, 'package.json'), JSON.stringify({ name }))

  it('comes from package.json, made into an app name', async () => {
    for (const [pkg, expected] of [
      ['tagtape', 'tagtape'],
      ['@acme/Blog_API', 'blog-api'],
      ['my.app', 'my-app'],
      ['2048-game', 'game'],
    ]) {
      await withPackage(pkg)
      assert.equal(await appName(dir), expected, pkg)
    }
  })

  it('prefers --name, and says what to do when there is none', async () => {
    await withPackage('from-package')
    assert.equal(await appName(dir, 'from-flag'), 'from-flag')
    await assert.rejects(appName(dir, 'Bad_Name'), /not a Spotcraft app name/)
    await rm(join(dir, 'package.json'))
    await assert.rejects(appName(dir), /pass the app name with --name/)
  })

  it('gives each app its own database URL on localhost', () => {
    assert.equal(
      databaseUrl('blog-api'),
      'postgres://app_blog_api:local-blog-api-password@127.0.0.1:54340/app_blog_api',
    )
  })

  describe('.env', () => {
    it('adds only what is missing and keeps every existing line', async () => {
      const original = '# mine\nAUTH_SECRET=keep-me\nDATABASE_URL=postgres://other/db'
      await writeFile(join(dir, '.env'), original)
      const env = await localEnv(dir, databaseUrl('demo'))
      assert.equal(env.get('AUTH_SECRET'), 'keep-me')
      assert.deepEqual(await writeMissing(dir, env), {
        added: [],
        kept: ['DATABASE_URL', 'AUTH_SECRET'],
      })
      assert.equal(await readFile(join(dir, '.env'), 'utf8'), original)
    })

    it('creates .env with a fresh secret, and a second run adds nothing', async () => {
      const env = await localEnv(dir, databaseUrl('demo'))
      assert.match(env.get('AUTH_SECRET') ?? '', /^[0-9a-f]{64}$/)
      assert.deepEqual((await writeMissing(dir, env)).added, ['DATABASE_URL', 'AUTH_SECRET'])
      const written = parseEnv(await readFile(join(dir, '.env'), 'utf8'))
      assert.equal(written.get('DATABASE_URL'), databaseUrl('demo'))
      assert.equal(written.get('AUTH_SECRET'), env.get('AUTH_SECRET'))
      const again = await localEnv(dir, databaseUrl('demo'))
      assert.deepEqual((await writeMissing(dir, again)).added, [])
    })
  })
})

describe('starting the stack', () => {
  /** Records calls; `failing` names the first argument that fails. */
  function fakeRunner(failing?: string) {
    const calls: { args: string[]; input?: string }[] = []
    const runner = async (_file: string, args: string[], input?: string): Promise<RunResult> => {
      calls.push({ args, input })
      const fails = failing !== undefined && args.includes(failing)
      return { code: fails ? 1 : 0, stdout: '', stderr: fails ? 'boom' : '' }
    }
    return { runner, calls }
  }

  it('checks Docker, starts and waits for Postgres, then sets up the role', async () => {
    const { runner, calls } = fakeRunner()
    await up(runner)
    assert.deepEqual(
      calls.map(({ args }) => args.slice(0, 2)),
      [
        ['version', '--format'],
        ['compose', '-p'],
        ['exec', '-i'],
      ],
    )
    assert.ok(calls[1].args.includes('--wait'))
    assert.equal(calls[1].input, composeFile(), 'the compose file goes on stdin')
    assert.deepEqual(calls[2].args.slice(0, 4), ['exec', '-i', '-u', 'postgres'])
    assert.match(calls[2].input ?? '', /^\\set pw \S+\n/)
    assert.ok(calls[2].input?.endsWith(ADMIN_SQL))
  })

  it('says plainly when Docker is not running', async () => {
    const { runner, calls } = fakeRunner('version')
    await assert.rejects(up(runner), (error: Error) => {
      assert.ok(error instanceof StackError)
      assert.match(error.message, /Docker is not running/)
      return true
    })
    assert.equal(calls.length, 1)
  })
})
