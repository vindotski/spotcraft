// Before `npm publish` (which doesn't know pnpm's `workspace:` protocol): replaces every
// `workspace:` dependency of the given packages with that package's own exact version. The kit
// has its own version (ADR 0027), so the CLI pins the kit it was built and tested with.
// Usage: node scripts/pin-workspace-deps.ts packages/cli [packages/…]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORKSPACE = [
  'agent',
  'apps/dashboard',
  'apps/site',
  'packages/cli',
  'packages/kit',
  'packages/ui',
]

type Manifest = { name: string; version: string } & Record<string, Record<string, string>>
const read = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
const versions = new Map(WORKSPACE.map((dir) => read(dir)).map((pkg) => [pkg.name, pkg.version]))

const dirs = process.argv.slice(2)
if (dirs.length === 0) {
  console.error('Usage: node scripts/pin-workspace-deps.ts <package dir>…')
  process.exit(1)
}

for (const dir of dirs) {
  const pkg = read(dir)
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (!range.startsWith('workspace:')) continue
      const version = versions.get(name)
      if (!version) {
        console.error(`${dir}: ${name} is not a workspace package`)
        process.exit(1)
      }
      pkg[field][name] = version
      console.log(`${dir}/package.json: ${name} ${range} → ${version}`)
    }
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
}
