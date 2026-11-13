// Spotcraft has one version (ADR 0019) for every workspace package except the kit, which has
// its own (ADR 0027).
// Usage: node scripts/check-versions.ts              check, exit 1 on a mismatch
//        node scripts/check-versions.ts 0.4.0        set every package but the kit to 0.4.0
//        node scripts/check-versions.ts --kit 0.3.1  set the kit's version
import { readFileSync, writeFileSync } from 'node:fs'

const files = [
  'package.json',
  'agent/package.json',
  'apps/dashboard/package.json',
  'apps/site/package.json',
  'packages/cli/package.json',
  'packages/ui/package.json',
]
const KIT = 'packages/kit/package.json'
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { version?: string }
const write = (file: string, version: string) => {
  const pkg = read(file)
  pkg.version = version
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
}
const fail = (message: string) => {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const kitIndex = args.indexOf('--kit')
if (kitIndex !== -1) {
  const version = args[kitIndex + 1]
  if (!version || !SEMVER.test(version)) fail(`Not a version: ${version ?? '(missing)'}`)
  write(KIT, version)
  console.log(`Set @spotcraft/kit to ${version}`)
  process.exit(0)
}

const target = args[0]
if (target !== undefined) {
  if (!SEMVER.test(target)) fail(`Not a version: ${target}`)
  for (const file of files) write(file, target)
  console.log(`Set every package but the kit to ${target}`)
  process.exit(0)
}

const expected = read('package.json').version
const wrong = files
  .map((file) => [file, read(file).version] as const)
  .filter(([, version]) => version !== expected)
  .map(([file, version]) => `${file}: ${version} (expected ${expected})`)
if (wrong.length > 0) fail(`Versions differ from the root package.json:\n  ${wrong.join('\n  ')}`)
const kit = read(KIT).version
if (!kit || !SEMVER.test(kit)) fail(`${KIT}: not a version: ${kit}`)
console.log(`All packages at ${expected}; @spotcraft/kit at ${kit}`)
