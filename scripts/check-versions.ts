// Spotcraft has one version (ADR 0019): every workspace package must carry the root's.
// Usage: node scripts/check-versions.ts            check, exit 1 on a mismatch
//        node scripts/check-versions.ts 0.2.0      set every package to 0.2.0
import { readFileSync, writeFileSync } from 'node:fs'

const files = [
  'package.json',
  'agent/package.json',
  'apps/dashboard/package.json',
  'apps/site/package.json',
  'packages/cli/package.json',
  'packages/kit/package.json',
  'packages/ui/package.json',
]
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const target = process.argv[2]
if (target !== undefined && !SEMVER.test(target)) {
  console.error(`Not a version: ${target}`)
  process.exit(1)
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { version?: string }
const expected = target ?? read('package.json').version
const wrong: string[] = []

for (const file of files) {
  const pkg = read(file)
  if (target !== undefined) {
    pkg.version = target
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  } else if (pkg.version !== expected) {
    wrong.push(`${file}: ${pkg.version} (expected ${expected})`)
  }
}

if (wrong.length > 0) {
  console.error(`Versions differ from the root package.json:\n  ${wrong.join('\n  ')}`)
  process.exit(1)
}
console.log(target === undefined ? `All packages at ${expected}` : `Set all packages to ${target}`)
